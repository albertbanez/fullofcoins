window.tweetFetcher = (() => {
    // --- State and Config ---
    const abi = [
        'event TweetPosted(uint256 id, address indexed author, string content, uint256 timestamp, uint256 chainId)',
    ]
    const cacheKey = 'cachedTweets'
    let allSortedTweets = []
    let currentOffset = 0
    const BATCH_SIZE = 10

    // --- NEW STATE for Banner ---
    let pendingNewTweets = []
    let newPostsBanner = null
    let showNewPostsBtn = null
    let tweetList = null

    // --- Caching --- (FIXED: Full implementation provided)
    function loadCache() {
        const raw = localStorage.getItem(cacheKey)
        // This now correctly returns {} if the cache is empty, preventing the error.
        return raw ? JSON.parse(raw) : {}
    }

    function saveCache(data) {
        const maxTotalTweets = 500
        const allTweets = []
        for (const chainId in data) {
            const tweets = data[chainId].tweets || []
            tweets.forEach((tweet) =>
                allTweets.push({ ...tweet, _chainId: chainId })
            )
        }
        allTweets.sort(compareTweets)
        const trimmed = allTweets.slice(0, maxTotalTweets)
        const grouped = {}
        trimmed.forEach((tweet) => {
            const cid = tweet._chainId
            if (!grouped[cid]) {
                grouped[cid] = {
                    tweets: [],
                    lastScannedBlock: data[cid]?.lastScannedBlock || null,
                }
            }
            delete tweet._chainId
            grouped[cid].tweets.push(tweet)
        })
        try {
            localStorage.setItem(cacheKey, JSON.stringify(grouped))
        } catch (err) {
            console.warn('⚠️ localStorage full or error saving cache:', err)
        }
    }

    // --- Fetching --- (FIXED: Full implementation provided)
    function getFromBlock(chainId, defaultStartBlock) {
        const cache = loadCache()
        const chainData = cache[chainId]
        return chainData?.lastScannedBlock
            ? chainData.lastScannedBlock + 1
            : defaultStartBlock
    }

    async function fetchTweetsForChain({
        rpcUrl,
        contractAddress,
        startBlock,
        chainId,
    }) {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
        const contract = new ethers.Contract(contractAddress, abi, provider)
        let latestBlock
        try {
            latestBlock = await provider.getBlockNumber()
        } catch (err) {
            return { tweets: [], lastScannedBlock: null }
        }
        let fromBlock = getFromBlock(chainId, startBlock)
        if (fromBlock > latestBlock)
            return { tweets: [], lastScannedBlock: fromBlock - 1 }
        const allTweets = []
        let finalScannedBlock = fromBlock - 1
        for (let from = fromBlock; from <= latestBlock; from += 10000) {
            const to = Math.min(from + 9999, latestBlock)
            try {
                const logs = await provider.getLogs({
                    address: contractAddress,
                    fromBlock: from,
                    toBlock: to,
                    topics: [
                        ethers.utils.id(
                            'TweetPosted(uint256,address,string,uint256,uint256)'
                        ),
                    ],
                })
                const parsedLogs = logs.map((log) => {
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
                finalScannedBlock = to
            } catch (err) {
                break
            }
        }
        return { tweets: allTweets, lastScannedBlock: finalScannedBlock }
    }

    function compareTweets(a, b) {
        if (b.blockNumber !== a.blockNumber)
            return b.blockNumber - a.blockNumber
        const aId = parseInt(a.id),
            bId = parseInt(b.id)
        if (bId !== aId) return bId - aId
        return b.timestamp - a.timestamp
    }

    // --- Helper Functions ---
    function escapeHTML(str) {
        const p = document.createElement('p')
        p.appendChild(document.createTextNode(str))
        return p.innerHTML
    }

    function createTweetElement(tweet) {
        const div = document.createElement('div')
        div.className = 'tweet'
        div.setAttribute('data-tweet-id', `${tweet.chainId}-${tweet.id}`)
        div.innerHTML = `<strong>${tweet.author}</strong><p>${escapeHTML(tweet.content)}</p><small>⛓ Chain: ${tweet.chainId} • 🕒 ${new Date(tweet.timestamp * 1000).toLocaleString()}</small>`
        return div
    }

    // --- Rendering ---
    function refreshAllSortedTweetsFromCache() {
        const cache = loadCache() // This will now receive {} instead of undefined
        const combined = []
        // This line will no longer crash because `cache` is an object.
        Object.values(cache).forEach((chainData) =>
            combined.push(...(chainData.tweets || []))
        )
        allSortedTweets = combined.sort(compareTweets)
    }

    function renderNextBatch() {
        if (currentOffset >= allSortedTweets.length) return
        const fragment = document.createDocumentFragment()
        const nextBatch = allSortedTweets.slice(
            currentOffset,
            currentOffset + BATCH_SIZE
        )
        nextBatch.forEach((tweet) => {
            fragment.appendChild(createTweetElement(tweet))
        })
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

        const fragment = document.createDocumentFragment()
        pendingNewTweets.forEach((tweet) => {
            fragment.appendChild(createTweetElement(tweet))
        })

        tweetList.prepend(fragment)
        allSortedTweets = [...pendingNewTweets, ...allSortedTweets]
        currentOffset += pendingNewTweets.length

        pendingNewTweets = []
        newPostsBanner.style.display = 'none'
    }

    // --- Core Logic ---
    async function fetchAndUpdateTweets(chains) {
        const cache = loadCache()
        let hasNewTweets = false
        for (const chain of chains) {
            const { tweets: freshTweets, lastScannedBlock } =
                await fetchTweetsForChain(chain)

            if (freshTweets.length > 0) hasNewTweets = true

            if (freshTweets.length === 0 && lastScannedBlock === null) continue
            const chainId = chain.chainId.toString()
            const existing = cache[chainId]?.tweets || []
            const merged = [...existing, ...freshTweets]
            const unique = Object.values(
                merged.reduce((map, tweet) => {
                    map[`${tweet.chainId}-${tweet.id}`] = tweet
                    return map
                }, {})
            )
            cache[chainId] = {
                tweets: unique,
                lastScannedBlock:
                    lastScannedBlock ??
                    cache[chainId]?.lastScannedBlock ??
                    chain.startBlock,
            }
        }
        saveCache(cache)

        if (hasNewTweets) {
            checkForNewTweets()
        }
    }

    function checkForNewTweets() {
        const cache = loadCache()
        const combinedFromCache = []
        Object.values(cache).forEach((chainData) =>
            combinedFromCache.push(...(chainData.tweets || []))
        )
        combinedFromCache.sort(compareTweets)

        const displayedIds = new Set(
            allSortedTweets.map((t) => `${t.chainId}-${t.id}`)
        )

        const newTweetsFromCache = combinedFromCache.filter(
            (t) => !displayedIds.has(`${t.chainId}-${t.id}`)
        )

        if (newTweetsFromCache.length > 0) {
            pendingNewTweets = newTweetsFromCache
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
                if (!tweetList || tweetList.children.length === 0) {
                    return
                }
                const lastTweet = tweetList.lastElementChild
                if (!lastTweet) return
                const rect = lastTweet.getBoundingClientRect()
                if (rect.top <= window.innerHeight + 300) {
                    renderNextBatch()
                }
            }, 100)
        })
    }

    // --- The Public API ---
    return {
        init,
        loadCachedTweets: renderInitialTweets,
        fetchAndUpdateTweets,
        checkForNewTweets,
    }
})()
