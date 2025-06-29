window.tweetFetcher = (() => {
    const ENABLE_BACKGROUND_BACKFILL = true

    const abi = [
        'event TweetPosted(uint256 id, address indexed author, string content, string imageCid, uint256 timestamp, uint256 chainId)',
    ]
    const cacheKey = 'cachedTweets_v2'
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

    // --- Cache Management ---

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

    async function fetchTweetsForRange({
        rpcUrl,
        contractAddress,
        fromBlock,
        toBlock,
    }) {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
        const contract = new ethers.Contract(contractAddress, abi, provider)
        const allTweets = []

        for (let from = fromBlock; from <= toBlock; from += 10000) {
            const to = Math.min(from + 9999, toBlock)
            try {
                const logs = await provider.getLogs({
                    address: contractAddress,
                    fromBlock: from,
                    toBlock: to,
                    topics: [contract.interface.getEventTopic('TweetPosted')],
                })
                const parsedLogs = logs.map(log => {
                    const parsed = contract.interface.parseLog(log)
                    const { id, author, content, timestamp, chainId } =
                        parsed.args
                    return {
                        id: id.toString(),
                        author,
                        content,
                        timestamp: parseInt(timestamp),
                        chainId: parseInt(chainId),
                        blockNumber: log.blockNumber,
                    }
                })
                allTweets.push(...parsedLogs)
            } catch (err) {
                console.warn(`Failed to fetch logs from ${from} to ${to}:`, err)
                return []
            }
        }
        return allTweets
    }

    async function fetchAndUpdateTweets(chains) {
        const cache = loadCache()
        let hasNewTweets = false

        for (const chain of chains) {
            const chainId = chain.chainId.toString()
            const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl)
            const latestBlock = await provider.getBlockNumber()

            if (!cache[chainId]) {
                cache[chainId] = { tweets: [], scannedRanges: [] }
            }
            const scannedRanges = cache[chainId].scannedRanges || []
            const highestRange = scannedRanges.reduce(
                (max, r) => (r.to > max.to ? r : max),
                { from: 0, to: 0 }
            )
            const lastScannedBlock = highestRange.to || chain.startBlock

            const delta = latestBlock - lastScannedBlock
            let fetchFrom, fetchTo

            if (delta > 500) {
                console.log(
                    `Large gap detected on chain ${chainId}. Fetching latest.`
                )
                fetchFrom = Math.max(latestBlock - 9999, chain.startBlock)
                fetchTo = latestBlock
            } else if (delta > 0) {
                fetchFrom = lastScannedBlock + 1
                fetchTo = latestBlock
            } else {
                continue
            }

            const freshTweets = await fetchTweetsForRange({
                ...chain,
                fromBlock: fetchFrom,
                toBlock: fetchTo,
            })

            if (freshTweets.length > 0) {
                hasNewTweets = true
                const existingTweets =
                    (cache[chainId] && cache[chainId].tweets) || []
                const merged = [...existingTweets, ...freshTweets]
                const unique = Object.values(
                    merged.reduce((map, tweet) => {
                        map[`${tweet.chainId}-${tweet.id}`] = tweet
                        return map
                    }, {})
                )
                cache[chainId].tweets = unique
            }
            cache[chainId].scannedRanges.push({ from: fetchFrom, to: fetchTo })
        }
        saveCache(cache)
        if (hasNewTweets) {
            checkForNewTweets()
        }

        if (ENABLE_BACKGROUND_BACKFILL) {
            startBackgroundBackfill(chains)
        }
    }

    // --- Background Back-filling Logic ---

    async function startBackgroundBackfill(chains) {
        if (isBackfilling) return
        isBackfilling = true
        console.log('Starting background backfill process...')

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
                    console.log(
                        `Back-filling gap on chain ${chainId}: blocks ${from} to ${to}`
                    )

                    const filledTweets = await fetchTweetsForRange({
                        ...chain,
                        fromBlock: from,
                        toBlock: to,
                    })
                    const currentCache = loadCache()

                    if (filledTweets.length > 0) {
                        const existingTweets =
                            (currentCache[chainId] &&
                                currentCache[chainId].tweets) ||
                            []
                        const merged = [...existingTweets, ...filledTweets]
                        const unique = Object.values(
                            merged.reduce((map, tweet) => {
                                map[`${tweet.chainId}-${tweet.id}`] = tweet
                                return map
                            }, {})
                        )
                        currentCache[chainId].tweets = unique
                    }

                    if (!currentCache[chainId])
                        currentCache[chainId] = {
                            tweets: [],
                            scannedRanges: [],
                        }
                    currentCache[chainId].scannedRanges.push({ from, to })
                    saveCache(currentCache)

                    if (filledTweets.length > 0) {
                        renderInitialTweets()
                    }
                    break
                }
            }
            if (gapFound) {
                setTimeout(backfillLoop, BACKFILL_INTERVAL)
            } else {
                console.log('Back-filling complete. No more gaps found.')
                isBackfilling = false
            }
        }
        setTimeout(backfillLoop, 5000)
    }

    // --- Rendering and UI Logic (Unchanged) ---

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
        div.innerHTML = `<strong>${tweet.author}</strong><p>${escapeHTML(
            tweet.content
        )}</p><small>⛓ Chain: ${tweet.chainId} • 🕒 ${new Date(
            tweet.timestamp * 1000
        ).toLocaleString()}</small>`
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
