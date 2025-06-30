// tweetFetcher.js

window.tweetFetcher = (() => {
    // MODIFIED: The ABI now includes all events we care about.
    const abi = [
        'event TweetPosted(uint256 id, address indexed author, string content, string imageCid, uint256 timestamp, uint256 chainId)',
        'event TweetLiked(uint256 indexed tweetId, address indexed user)',
        'event TweetUnliked(uint256 indexed tweetId, address indexed user)',
    ]

    let chainInfoMap = new Map()
    const ENABLE_BACKGROUND_BACKFILL = true
    const cacheKey = 'cachedTweets_v3' // NEW: Update cache version for new data structure
    let allSortedTweets = []
    let currentOffset = 0
    const BATCH_SIZE = 10
    const BACKFILL_CHUNK_SIZE = 5000
    const BACKFILL_INTERVAL = 10000
    let pendingNewTweets = []
    let newPostsBanner = null
    let showNewPostsBtn = null
    let tweetList = null
    let isBackfilling = false

    // --- Cache Management (Unchanged from your latest version) ---
    function loadCache() {
        const raw = localStorage.getItem(cacheKey)
        return raw ? JSON.parse(raw) : {}
    }
    function mergeRanges(ranges) {
        if (!ranges || ranges.length < 2) return ranges || []
        ranges.sort((a, b) => a.from - b.from)
        const merged = [ranges[0]]
        for (let i = 1; i < ranges.length; i++) {
            const last = merged[merged.length - 1]
            const current = ranges[i]
            if (current.from <= last.to + 1) {
                last.to = Math.max(last.to, current.to)
            } else {
                merged.push(current)
            }
        }
        return merged
    }
    function saveCache(data) {
        const maxTotalTweets = 500
        const allTweets = []
        for (const chainId in data) {
            if (data[chainId] && data[chainId].scannedRanges) {
                data[chainId].scannedRanges = mergeRanges(
                    data[chainId].scannedRanges
                )
            }
            const tweets = (data[chainId] && data[chainId].tweets) || []
            tweets.forEach(tweet =>
                allTweets.push({ ...tweet, _chainId: chainId })
            )
        }
        allTweets.sort(compareTweets)
        const trimmed = allTweets.slice(0, maxTotalTweets)
        const grouped = {}
        trimmed.forEach(tweet => {
            const cid = tweet._chainId
            if (!grouped[cid]) {
                grouped[cid] = {
                    tweets: [],
                    scannedRanges: (data[cid] && data[cid].scannedRanges) || [],
                }
            }
            delete tweet._chainId
            grouped[cid].tweets.push(tweet)
        })
        for (const chainId in data) {
            if (!grouped[chainId]) {
                grouped[chainId] = {
                    tweets: [],
                    scannedRanges:
                        (data[chainId] && data[chainId].scannedRanges) || [],
                }
            }
        }
        try {
            localStorage.setItem(cacheKey, JSON.stringify(grouped))
        } catch (err) {
            console.warn('⚠️ localStorage full or error saving cache:', err)
        }
    }

    // --- Fetching Logic ---

    // MODIFIED: This function now fetches ALL relevant events (posts, likes, unlikes) in a given range.
    async function fetchEventsForRange({
        rpcUrl,
        contractAddress,
        fromBlock,
        toBlock,
    }) {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
        const contract = new ethers.Contract(contractAddress, abi, provider)
        const allEvents = []

        for (let from = fromBlock; from <= toBlock; from += 10000) {
            const to = Math.min(from + 9999, toBlock)
            try {
                // Fetch logs for all three event types at once.
                const logs = await provider.getLogs({
                    address: contractAddress,
                    fromBlock: from,
                    toBlock: to,
                    topics: [
                        [
                            contract.interface.getEventTopic('TweetPosted'),
                            contract.interface.getEventTopic('TweetLiked'),
                            contract.interface.getEventTopic('TweetUnliked'),
                        ],
                    ],
                })

                const parsedEvents = logs
                    .map(log => {
                        try {
                            const parsed = contract.interface.parseLog(log)
                            return { ...parsed, blockNumber: log.blockNumber }
                        } catch (e) {
                            return null // Ignore logs that don't match our ABI
                        }
                    })
                    .filter(e => e !== null)

                allEvents.push(...parsedEvents)
            } catch (err) {
                console.warn(`Failed to fetch logs from ${from} to ${to}:`, err)
                return []
            }
        }
        return allEvents
    }

    function processEvents(events, existingTweets = [], chainId) {
        // <-- Added chainId here
        const tweetMap = new Map(
            existingTweets.map(t => [`${t.chainId}-${t.id}`, t])
        )

        events.sort((a, b) => {
            if (a.blockNumber !== b.blockNumber)
                return a.blockNumber - b.blockNumber
            return a.logIndex - b.logIndex
        })

        for (const event of events) {
            const { name, args } = event

            if (name === 'TweetPosted') {
                const tweet = {
                    id: args.id.toString(),
                    author: args.author,
                    content: args.content,
                    imageCid: args.imageCid,
                    timestamp: parseInt(args.timestamp),
                    chainId: parseInt(args.chainId),
                    blockNumber: event.blockNumber,
                    likeCount: 0,
                    likers: new Set(),
                }
                tweetMap.set(`${tweet.chainId}-${tweet.id}`, tweet)
            } else if (name === 'TweetLiked') {
                // Use the chainId passed into the function to build the correct key
                const key = `${chainId}-${args.tweetId.toString()}`
                const tweet = tweetMap.get(key)
                if (tweet && !tweet.likers.has(args.user)) {
                    tweet.likers.add(args.user)
                    tweet.likeCount = tweet.likers.size
                }
            } else if (name === 'TweetUnliked') {
                // Also fix it here for unlikes
                const key = `${chainId}-${args.tweetId.toString()}`
                const tweet = tweetMap.get(key)
                if (tweet && tweet.likers.has(args.user)) {
                    tweet.likers.delete(args.user)
                    tweet.likeCount = tweet.likers.size
                }
            }
        }

        const finalTweets = Array.from(tweetMap.values())
        finalTweets.forEach(t => (t.likers = Array.from(t.likers)))

        return finalTweets
    }
    async function fetchAndUpdateTweets(chains) {
        const cache = loadCache()
        let hasNewTweets = false

        for (const chain of chains) {
            // ... (rest of the function up to fetching is the same)
            const chainId = chain.chainId.toString()
            const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl)
            const latestBlock = await provider.getBlockNumber()
            if (!cache[chainId])
                cache[chainId] = { tweets: [], scannedRanges: [] }
            const scannedRanges = cache[chainId].scannedRanges || []
            const highestRange = scannedRanges.reduce(
                (max, r) => (r.to > max.to ? r : max),
                { from: 0, to: 0 }
            )
            const lastScannedBlock = highestRange.to || chain.startBlock
            const delta = latestBlock - lastScannedBlock
            let fetchFrom, fetchTo
            if (delta > 500) {
                fetchFrom = Math.max(latestBlock - 9999, chain.startBlock)
                fetchTo = latestBlock
            } else if (delta > 0) {
                fetchFrom = lastScannedBlock + 1
                fetchTo = latestBlock
            } else {
                continue
            }

            // MODIFIED: Fetch events, not just tweets
            const freshEvents = await fetchEventsForRange({
                ...chain,
                fromBlock: fetchFrom,
                toBlock: fetchTo,
            })

            if (freshEvents.length > 0) {
                // If we get a TweetPosted event, we consider it a new tweet for banner purposes
                if (freshEvents.some(e => e.name === 'TweetPosted')) {
                    hasNewTweets = true
                }

                const existingTweets = (cache[chainId].tweets || []).map(t => ({
                    ...t,
                    likers: new Set(t.likers),
                })) // Rehydrate Set
                const updatedTweets = processEvents(
                    freshEvents,
                    existingTweets,
                    chain.chainId
                )
                cache[chainId].tweets = updatedTweets
            }

            cache[chainId].scannedRanges.push({ from: fetchFrom, to: fetchTo })
        }

        saveCache(cache)
        if (hasNewTweets) checkForNewTweets()
        if (ENABLE_BACKGROUND_BACKFILL) startBackgroundBackfill(chains)
    }

    // --- Background Backfill (needs slight modification) ---
    async function startBackgroundBackfill(chains) {
        if (isBackfilling) return
        isBackfilling = true
        const backfillLoop = async () => {
            const cache = loadCache()
            let gapFound = false
            for (const chain of chains) {
                const chainId = chain.chainId.toString()
                const chainData = cache[chainId]
                if (!chainData || !chainData.scannedRanges) continue
                const ranges = mergeRanges(chainData.scannedRanges)
                let highestGap = { size: 0, from: 0, to: 0 }
                let lastTo = chain.startBlock
                for (const range of ranges) {
                    const gapSize = range.from - lastTo
                    if (gapSize > highestGap.size) {
                        highestGap = {
                            size: gapSize,
                            from: lastTo + 1,
                            to: range.from - 1,
                        }
                    }
                    lastTo = range.to
                }
                if (highestGap.size > 1) {
                    gapFound = true
                    const from = Math.max(
                        highestGap.from,
                        highestGap.to - BACKFILL_CHUNK_SIZE + 1
                    )
                    const to = highestGap.to

                    // MODIFIED: Fetch and process events, not just tweets
                    const filledEvents = await fetchEventsForRange({
                        ...chain,
                        fromBlock: from,
                        toBlock: to,
                    })
                    if (filledEvents.length > 0) {
                        const currentCache = loadCache()
                        const existingTweets = (
                            currentCache[chainId]?.tweets || []
                        ).map(t => ({ ...t, likers: new Set(t.likers) }))
                        const updatedTweets = processEvents(
                            filledEvents,
                            existingTweets,
                            chain.chainId
                        )
                        currentCache[chainId].tweets = updatedTweets
                        currentCache[chainId].scannedRanges.push({ from, to })
                        saveCache(currentCache)
                        renderInitialTweets()
                    } else {
                        const currentCache = loadCache()
                        currentCache[chainId].scannedRanges.push({ from, to })
                        saveCache(currentCache)
                    }
                    break
                }
            }
            if (gapFound) {
                setTimeout(backfillLoop, BACKFILL_INTERVAL)
            } else {
                isBackfilling = false
            }
        }
        setTimeout(backfillLoop, 5000)
    }

    // --- Rendering Logic ---
    function compareTweets(a, b) {
        if (b.blockNumber !== a.blockNumber)
            return b.blockNumber - a.blockNumber
        const aId = parseInt(a.id),
            bId = parseInt(b.id)
        if (bId !== aId) return bId - aId
        return b.timestamp - a.timestamp
    }
    function escapeHTML(str) {
        const p = document.createElement('p')
        p.appendChild(document.createTextNode(str))
        return p.innerHTML
    }

    function createTweetElement(tweet) {
        const div = document.createElement('div')
        div.className = 'tweet'
        div.setAttribute('data-tweet-id', `${tweet.chainId}-${tweet.id}`)

        let imageHtml = ''
        // Revert to the simple check for a valid image CID.
        // We no longer need to parse for media type.
        if (
            tweet.imageCid &&
            (tweet.imageCid.startsWith('Qm') ||
                tweet.imageCid.startsWith('baf'))
        ) {
            const imageUrl = `https://ipfs.io/ipfs/${tweet.imageCid}`
            imageHtml = `<a href="${imageUrl}" target="_blank" rel="noopener noreferrer">
                        <img src="${imageUrl}" alt="Tweet image" class="tweet-image" />
                     </a>`
        }

        // The rest of the function remains the same
        const chainName = chainInfoMap.get(tweet.chainId)?.name || tweet.chainId
        const date = new Date(tweet.timestamp * 1000)
        const formattedDate = new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        }).format(date)
        const formattedTime = new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            hour12: true,
        }).format(date)
        const finalDateTimeString = `${formattedDate}, ${formattedTime}`
        let userHasLiked = false
        if (window.connectedAddress) {
            const likers = new Set(
                (tweet.likers || []).map(l => l.toLowerCase())
            )
            userHasLiked = likers.has(window.connectedAddress.toLowerCase())
        }

        div.innerHTML = `
        <strong>${tweet.author}</strong>
        <p>${escapeHTML(tweet.content)}</p>
        ${imageHtml}
        <small>⛓ Chain: ${chainName} • 🕒 ${finalDateTimeString}</small>
        <div class="tweet-actions">
            <button class="like-btn ${userHasLiked ? 'liked' : ''}" data-tweet-id="${tweet.id}" data-chain-id="${tweet.chainId}">
                <span class="icon">${userHasLiked ? '❤️' : '🤍'}</span>
                <span class="count">${tweet.likeCount || 0}</span>
            </button>
        </div>
    `

        return div
    }
    function refreshAllSortedTweetsFromCache() {
        const cache = loadCache()
        const combined = []
        Object.values(cache).forEach(chainData => {
            if (chainData && chainData.tweets) {
                combined.push(...chainData.tweets)
            }
        })
        allSortedTweets = combined.sort(compareTweets)
    }
    function renderNextBatch() {
        if (currentOffset >= allSortedTweets.length) return
        const fragment = document.createDocumentFragment()
        const nextBatch = allSortedTweets.slice(
            currentOffset,
            currentOffset + BATCH_SIZE
        )
        nextBatch.forEach(tweet =>
            fragment.appendChild(createTweetElement(tweet))
        )
        tweetList.appendChild(fragment)
        currentOffset += BATCH_SIZE
    }
    function renderInitialTweets() {
        tweetList.innerHTML = ''
        currentOffset = 0
        refreshAllSortedTweetsFromCache()
        if (allSortedTweets.length === 0) {
            tweetList.innerHTML = `<p style="opacity: 0.6;">No tweets found on-chain yet.</p>`
            return
        }
        renderNextBatch()
    }
    function showPendingTweets() {
        if (pendingNewTweets.length === 0) return
        allSortedTweets = [...pendingNewTweets, ...allSortedTweets]
        allSortedTweets = Object.values(
            allSortedTweets.reduce((map, tweet) => {
                map[`${tweet.chainId}-${tweet.id}`] = tweet
                return map
            }, {})
        ).sort(compareTweets)
        renderInitialTweets()
        pendingNewTweets = []
        newPostsBanner.style.display = 'none'
    }
    function checkForNewTweets() {
        const displayedIds = new Set(
            allSortedTweets.map(t => `${t.chainId}-${t.id}`)
        )
        const cache = loadCache()
        const combinedFromCache = []
        Object.values(cache).forEach(chainData => {
            if (chainData && chainData.tweets) {
                combinedFromCache.push(...chainData.tweets)
            }
        })
        const newTweetsFromCache = combinedFromCache.filter(
            t => !displayedIds.has(`${t.chainId}-${t.id}`)
        )
        if (newTweetsFromCache.length > 0) {
            pendingNewTweets = newTweetsFromCache.sort(compareTweets)
            showNewPostsBtn.textContent = `Show ${pendingNewTweets.length} new post${pendingNewTweets.length > 1 ? 's' : ''}`
            newPostsBanner.style.display = 'block'
        }
    }
    function init() {
        chainInfoMap = new Map((window.chains || []).map(c => [c.chainId, c]))
        newPostsBanner = document.getElementById('newPostsBanner')
        showNewPostsBtn = document.getElementById('showNewPostsBtn')
        tweetList = document.getElementById('tweetList')
        if (showNewPostsBtn) {
            showNewPostsBtn.addEventListener('click', showPendingTweets)
        }
        let scrollTimeout = null
        window.addEventListener('scroll', () => {
            if (scrollTimeout) return
            scrollTimeout = setTimeout(() => {
                scrollTimeout = null
                if (!tweetList || tweetList.children.length === 0) return
                const lastTweet = tweetList.lastElementChild
                if (!lastTweet) return
                const rect = lastTweet.getBoundingClientRect()
                if (rect.top <= window.innerHeight + 300) {
                    renderNextBatch()
                }
            }, 100)
        })
    }

    return {
        init,
        loadCachedTweets: renderInitialTweets,
        fetchAndUpdateTweets,
        checkForNewTweets,
    }
})()
