window.tweetFetcher = (() => {
    const abi = [
        'event TweetPosted(uint256 id, address indexed author, string content, uint256 timestamp, uint256 chainId)',
    ]

    const cacheKey = 'cachedTweets'
    let currentTweetMap = {}
    let allSortedTweets = []

    function loadCache() {
        const raw = localStorage.getItem(cacheKey)
        return raw ? JSON.parse(raw) : {}
    }

    function saveCache(data) {
        const maxTotalTweets = 500
        const allTweets = []

        for (const chainId in data) {
            const tweets = data[chainId].tweets || []
            tweets.forEach((tweet) => {
                allTweets.push({ ...tweet, _chainId: chainId })
            })
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
            showWarningToast('🧹 Cache too large. Old tweets removed.')
        }
    }

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
        if (fromBlock > latestBlock) fromBlock = latestBlock

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

    function renderTweets(tweets) {
        const tweetList = document.getElementById('tweetList')
        tweetList.innerHTML = ''
        currentTweetMap = {}

        allSortedTweets = tweets.sort(compareTweets)

        if (allSortedTweets.length === 0) {
            tweetList.innerHTML = `<p style="opacity: 0.6;">No tweets found on-chain yet.</p>`
            return
        }

        allSortedTweets.forEach((tweet) => {
            const div = document.createElement('div')
            div.className = 'tweet'
            div.innerHTML = `
        <strong>${tweet.author}</strong>
        <p>${tweet.content}</p>
        <small>⛓ Chain: ${tweet.chainId} • 🕒 ${new Date(tweet.timestamp * 1000).toLocaleString()}</small>
      `
            tweetList.appendChild(div)
            currentTweetMap[`${tweet.chainId}-${tweet.id}`] = true
        })
    }

    function loadCachedTweets() {
        const cache = loadCache()
        const combined = []

        Object.values(cache).forEach((chainData) => {
            if (chainData.tweets) {
                combined.push(...chainData.tweets)
            }
        })

        const sorted = combined.sort(compareTweets)
        renderTweets(sorted)
    }

    async function fetchAndUpdateTweets(chains) {
        const cache = loadCache()
        let allTweets = []

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

            allTweets.push(...unique)
        }

        saveCache(cache)

        const finalMap = allTweets.reduce((map, tweet) => {
            map[`${tweet.chainId}-${tweet.id}`] = tweet
            return map
        }, {})
        const sorted = Object.values(finalMap).sort(compareTweets)

        renderTweets(sorted)
    }

    function compareTweets(a, b) {
        const aId = parseInt(a.id)
        const bId = parseInt(b.id)

        if (b.blockNumber !== a.blockNumber)
            return b.blockNumber - a.blockNumber
        if (bId !== aId) return bId - aId
        return b.timestamp - a.timestamp
    }

    function showWarningToast(msg) {
        const toast = document.getElementById('toast')
        if (!toast) return
        toast.textContent = msg
        toast.style.backgroundColor = '#ffc107'
        toast.classList.add('show')
        setTimeout(() => toast.classList.remove('show'), 4000)
    }

    return {
        loadCachedTweets,
        fetchAndUpdateTweets,
    }
})()
