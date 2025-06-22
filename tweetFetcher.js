window.tweetFetcher = (() => {
    const abi = [
        'event TweetPosted(uint256 id, address indexed author, string content, uint256 timestamp, uint256 chainId)',
    ]

    const cacheKey = 'cachedTweets'
    const maxTweetAge = 180 // Optional: skip scan if recent tweets within 3 minutes

    function getLastScannedBlock(chainId, defaultStart) {
        const raw = localStorage.getItem(`lastScannedBlock_${chainId}`)
        const block = raw ? parseInt(raw) : defaultStart
        return isNaN(block) ? defaultStart : block
    }

    function setLastScannedBlock(chainId, block) {
        localStorage.setItem(`lastScannedBlock_${chainId}`, block)
    }

    function timeAgo(timestamp) {
        const seconds = Math.floor(Date.now() / 1000 - timestamp)
        if (seconds < 60) return `${seconds}s ago`
        const minutes = Math.floor(seconds / 60)
        if (minutes < 60) return `${minutes}m ago`
        const hours = Math.floor(minutes / 60)
        if (hours < 24) return `${hours}h ago`
        const days = Math.floor(hours / 24)
        return `${days}d ago`
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

        let fromBlock = getLastScannedBlock(chainId, startBlock)

        if (fromBlock > latestBlock) {
            console.warn(
                `lastScannedBlock (${fromBlock}) > latestBlock (${latestBlock}), adjusting`
            )
            fromBlock = latestBlock
        }

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
                    }
                })

                if (parsedLogs.length > 0) {
                    allTweets.push(...parsedLogs)
                    setLastScannedBlock(chainId, to) // ✅ Only if tweets found
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
            ) // ✅ newest first
            renderTweets(sorted)
        } catch (err) {
            console.warn('Failed to parse cached tweets:', err)
        }
    }
    async function fetchAndUpdateTweets(chains) {
        const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}')
        let combined = []

        for (const chain of chains) {
            const previous = cache[chain.chainId] || []
            const latestCached =
                previous.length > 0
                    ? Math.max(...previous.map((t) => t.timestamp))
                    : 0

            const age = Math.floor(Date.now() / 1000) - latestCached

            if (age < maxTweetAge) {
                console.log(
                    `⏩ Skipping chain ${chain.chainId}, tweets are fresh (${age}s ago)`
                )
                combined.push(...previous)
                continue
            }

            const fresh = await fetchTweetsForChain(chain)

            if (fresh.length > 0) {
                const combinedChainTweets = [...previous, ...fresh]
                const unique = Object.values(
                    combinedChainTweets.reduce((map, tweet) => {
                        map[`${tweet.chainId}-${tweet.id}`] = tweet
                        return map
                    }, {})
                )

                cache[chain.chainId] = unique
                combined.push(...unique)
            } else if (previous.length > 0) {
                combined.push(...previous) // Use existing if no new found
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
        <small>⛓ Chain: ${tweet.chainId} • 🕒 ${timeAgo(tweet.timestamp)}</small>
      `
            tweetList.appendChild(div)
        })
    }

    return {
        loadCachedTweets,
        fetchAndUpdateTweets,
    }
})()
