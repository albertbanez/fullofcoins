window.tweetFetcher = (() => {
    const abi = [
        'event TweetPosted(uint256 id, address indexed author, string content, uint256 timestamp, uint256 chainId)',
    ]

    const cacheKey = 'cachedTweets'

    // Get fromBlock based on cached tweets for this chain
    function getFromBlockFromCache(chainId, defaultStartBlock) {
        const raw = localStorage.getItem(cacheKey)
        if (!raw) return defaultStartBlock

        try {
            const cache = JSON.parse(raw)
            const chainTweets = cache[chainId] || []
            if (chainTweets.length === 0) return defaultStartBlock

            // Get max blockNumber from cached tweets
            const maxBlock = Math.max(
                ...chainTweets.map((t) => t.blockNumber || 0)
            )
            // Start scanning from next block after max cached block
            return maxBlock > 0 ? maxBlock + 1 : defaultStartBlock
        } catch (e) {
            return defaultStartBlock
        }
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
            return []
        }

        // Use cached tweets to find fromBlock, fallback to startBlock
        let fromBlock = getFromBlockFromCache(chainId, startBlock)
        if (fromBlock > latestBlock) fromBlock = latestBlock

        const allTweets = []

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

                if (parsedLogs.length > 0) {
                    allTweets.push(...parsedLogs)
                    // no more storing last scanned block locally, skip that
                }
            } catch (err) {
                console.warn(
                    `Error scanning ${from}-${to} on chain ${chainId}`,
                    err.message
                )
                break
            }
        }

        return allTweets
    }

    function loadCachedTweets() {
        const raw = localStorage.getItem(cacheKey)
        if (!raw) return

        try {
            const cache = JSON.parse(raw)
            const tweets = Object.values(cache)
                .flat()
                .reduce((map, tweet) => {
                    map[`${tweet.chainId}-${tweet.id}`] = tweet
                    return map
                }, {})

            const sorted = Object.values(tweets).sort(
                (a, b) => b.timestamp - a.timestamp
            )
            renderTweets(sorted)
        } catch (err) {
            console.warn('Failed to parse cached tweets:', err)
        }
    }

    async function fetchAndUpdateTweets(chains) {
        const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}')
        let combined = []

        for (const chain of chains) {
            const fresh = await fetchTweetsForChain(chain)

            if (fresh.length > 0) {
                const previous = cache[chain.chainId] || []
                const combinedChainTweets = [...previous, ...fresh]

                const unique = Object.values(
                    combinedChainTweets.reduce((map, tweet) => {
                        map[`${tweet.chainId}-${tweet.id}`] = tweet
                        return map
                    }, {})
                )

                cache[chain.chainId] = unique
                combined.push(...unique)
            } else if (cache[chain.chainId]) {
                combined.push(...cache[chain.chainId])
            }
        }

        const finalTweets = Object.values(
            combined.reduce((map, tweet) => {
                map[`${tweet.chainId}-${tweet.id}`] = tweet
                return map
            }, {})
        ).sort((a, b) => b.timestamp - a.timestamp)

        localStorage.setItem(cacheKey, JSON.stringify(cache))
        renderTweets(finalTweets)
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
