window.tweetFetcher = (() => {
    const abi = [
        'event TweetPosted(uint256 id, address indexed author, string content, uint256 timestamp, uint256 chainId)',
    ]

    const cacheKey = 'cachedTweets'

    function loadCache() {
        const raw = localStorage.getItem(cacheKey)
        return raw ? JSON.parse(raw) : {}
    }

    function saveCache(data) {
        localStorage.setItem(cacheKey, JSON.stringify(data))
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

    function loadCachedTweets() {
        const cache = loadCache()
        const combined = []

        Object.values(cache).forEach((chainData) => {
            if (chainData.tweets) {
                combined.push(...chainData.tweets)
            }
        })

        const sorted = combined.sort((a, b) => b.timestamp - a.timestamp)
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

        const finalSorted = allTweets.reduce((map, tweet) => {
            map[`${tweet.chainId}-${tweet.id}`] = tweet
            return map
        }, {})

        const sorted = Object.values(finalSorted).sort(
            (a, b) => b.timestamp - a.timestamp
        )
        renderTweets(sorted)
    }

    function renderTweets(tweets) {
        const tweetList = document.getElementById('tweetList')
        tweetList.innerHTML = ''

        if (!tweets || tweets.length === 0) {
            tweetList.innerHTML = `<p style="opacity: 0.6;">No tweets found on-chain yet.</p>`
            return
        }

        tweets.forEach((tweet) => {
            const div = document.createElement('div')
            div.className = 'tweet'
            div.innerHTML = `
        <strong>${tweet.author}</strong>
        <p>${tweet.content}</p>
        <small>⛓ Chain: ${tweet.chainId} • 🕒 ${new Date(tweet.timestamp * 1000).toLocaleString()}</small>
      `
            tweetList.appendChild(div)
        })
    }

    return {
        loadCachedTweets,
        fetchAndUpdateTweets,
    }
})()
