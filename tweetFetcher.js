window.tweetFetcher = (() => {
    // --- State and Config ---
    const abi = [
        'event TweetPosted(uint256 id, address indexed author, string content, uint256 timestamp, uint256 chainId)',
    ]
    const cacheKey = 'cachedTweets'
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

    // --- Rendering ---
    function refreshAllSortedTweetsFromCache() {
        const cache = loadCache()
        const combined = []
        Object.values(cache).forEach((chainData) =>
            combined.push(...(chainData.tweets || []))
        )
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
            div.innerHTML = `<strong>${tweet.author}</strong><p>${escapeHTML(tweet.content)}</p><small>⛓ Chain: ${tweet.chainId} • 🕒 ${new Date(tweet.timestamp * 1000).toLocaleString()}</small>`
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

    function escapeHTML(str) {
        const p = document.createElement('p')
        p.appendChild(document.createTextNode(str))
        return p.innerHTML
    }

    async function fetchAndUpdateTweets(chains) {
        const cache = loadCache()
        for (const chain of chains) {
            const { tweets: freshTweets, lastScannedBlock } =
                await fetchTweetsForChain(chain)
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
    }

    // --- THE SCROLL LISTENER, NOW CORRECT FOR THE NEW CSS ---
    function init() {
        let scrollTimeout = null
        window.addEventListener('scroll', () => {
            if (scrollTimeout) return

            scrollTimeout = setTimeout(() => {
                scrollTimeout = null

                const tweetList = document.getElementById('tweetList')
                // Safety check: if there's no list or it has no tweets, do nothing.
                if (!tweetList || tweetList.children.length === 0) {
                    return
                }

                // Get the very last tweet element that is currently on the page.
                const lastTweet = tweetList.lastElementChild
                if (!lastTweet) return

                // getBoundingClientRect() gives us the element's size and position relative to the viewport.
                const rect = lastTweet.getBoundingClientRect()

                // The condition to check:
                // Is the top of the last tweet less than or equal to the viewport height?
                // This means the last tweet is either visible on screen or has been scrolled past.
                // We add a threshold (e.g., 300px) to start loading new tweets *before* the user hits the exact bottom.
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
    }
})()
