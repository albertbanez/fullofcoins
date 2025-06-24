window.tweetFetcher = (() => {
    // --- State and Config ---
    const abi = [
        'event TweetPosted(uint256 id, address indexed author, string content, uint256 timestamp, uint256 chainId)',
    ]
    const cacheKey = 'cachedTweets'
    let currentTweetMap = {}
    let allSortedTweets = []
    let currentOffset = 0
    const BATCH_SIZE = 10

    // --- Caching ---
    function loadCache() {
        const raw = localStorage.getItem(cacheKey)
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

    // --- Fetching ---
    function getFromBlock(chainId, defaultStartBlock) {
        const cache = loadCache()
        const chainData = cache[chainId]
        if (!chainData || !chainData.lastScannedBlock) return defaultStartBlock
        return chainData.lastScannedBlock + 1
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
            console.warn(`Failed to get latest block for chain ${chainId}`, err)
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
                console.warn(
                    `Error scanning ${from}-${to} on chain ${chainId}:`,
                    err.message
                )
                break
            }
        }
        return { tweets: allTweets, lastScannedBlock: finalScannedBlock }
    }

    function compareTweets(a, b) {
        const aId = parseInt(a.id)
        const bId = parseInt(b.id)
        if (b.blockNumber !== a.blockNumber)
            return b.blockNumber - a.blockNumber
        if (bId !== aId) return bId - aId
        return b.timestamp - a.timestamp
    }

    // --- Rendering ---
    function refreshAllSortedTweetsFromCache() {
        const cache = loadCache()
        const combined = []
        Object.values(cache).forEach((chainData) => {
            if (chainData.tweets) combined.push(...chainData.tweets)
        })
        allSortedTweets = combined.sort(compareTweets)
    }

    function renderNextBatch() {
        if (currentOffset >= allSortedTweets.length) return
        const tweetList = document.getElementById('tweetList')
        const fragment = document.createDocumentFragment()
        const nextBatch = allSortedTweets.slice(
            currentOffset,
            currentOffset + BATCH_SIZE
        )
        nextBatch.forEach((tweet) => {
            const div = document.createElement('div')
            div.className = 'tweet'
            div.innerHTML = `<strong>${tweet.author}</strong><p>${tweet.content}</p><small>⛓ Chain: ${tweet.chainId} • 🕒 ${new Date(tweet.timestamp * 1000).toLocaleString()}</small>`
            fragment.appendChild(div)
        })
        tweetList.appendChild(fragment)
        currentOffset += BATCH_SIZE
    }

    function renderInitialTweets() {
        const tweetList = document.getElementById('tweetList')
        tweetList.innerHTML = ''
        currentOffset = 0
        refreshAllSortedTweetsFromCache()
        if (allSortedTweets.length === 0) {
            tweetList.innerHTML = `<p style="opacity: 0.6;">No tweets found on-chain yet.</p>`
            return
        }
        renderNextBatch()
    }

    async function fetchAndUpdateTweets(chains) {
        const cache = loadCache()
        for (const chain of chains) {
            const { tweets: freshTweets, lastScannedBlock } =
                await fetchTweetsForChain(chain)
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
    }

    // --- NEW: THE SELF-CONTAINED INITIALIZATION AND SCROLL LISTENER ---
    function init() {
        const feed = document.querySelector('.main-feed')
        if (!feed) {
            console.error(
                'Could not find .main-feed element to attach scroll listener.'
            )
            return
        }

        let scrollTimeout = null
        feed.addEventListener('scroll', () => {
            if (scrollTimeout) return
            scrollTimeout = setTimeout(() => {
                scrollTimeout = null
                const scrollTop = feed.scrollTop
                const scrollHeight = feed.scrollHeight
                const clientHeight = feed.clientHeight
                const threshold = 100

                if (scrollTop + clientHeight >= scrollHeight - threshold) {
                    renderNextBatch()
                }
            }, 100)
        })
    }

    // --- The Public API ---
    return {
        init, // Expose the new init function
        loadCachedTweets: renderInitialTweets, // Rename for clarity, this is what the HTML calls
        fetchAndUpdateTweets,
    }
})()
