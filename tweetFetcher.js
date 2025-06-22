window.tweetFetcher = (() => {
    const abi = [
        'event TweetPosted(uint256 id, address indexed author, string content, uint256 timestamp, uint256 chainId)',
    ]

    const cacheKey = 'cachedTweets'

    function getLastScannedBlock(chainId, defaultStart) {
        const raw = localStorage.getItem(`lastScannedBlock_${chainId}`)
        const block = raw ? parseInt(raw) : defaultStart
        return isNaN(block) ? defaultStart : block
    }

    function setLastScannedBlock(chainId, block) {
        localStorage.setItem(`lastScannedBlock_${chainId}`, block)
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

                allTweets.push(...parsedLogs)

                // ✅ Only update last scanned block after a successful range
                setLastScannedBlock(chainId, to)
            } catch (err) {
                console.warn(
                    `Error scanning ${from}-${to} on chain ${chainId}`,
                    err.message
                )
                break // Stop scanning on persistent error
            }
        }

        return allTweets
    }

    function loadCachedTweets() {
        const raw = localStorage.getItem(cacheKey)
        if (!raw) return

        console.log(raw)

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
            cache[chain.chainId] = fresh
            combined = combined.concat(fresh)
        }

        // Deduplicate + sort
        const unique = Object.values(
            combined.reduce((map, tweet) => {
                map[`${tweet.chainId}-${tweet.id}`] = tweet
                return map
            }, {})
        ).sort((a, b) => b.timestamp - a.timestamp)

        localStorage.setItem(cacheKey, JSON.stringify(cache))
        renderTweets(unique)
    }

    function renderTweets(tweets) {
        const tweetList = document.getElementById('tweetList')
        tweetList.innerHTML = ''

        tweets.forEach((tweet) => {
            const div = document.createElement('div')
            div.className = 'tweet'
            div.innerHTML = `
        <strong>${tweet.author}</strong>
        <p>${tweet.content}</p>
        <small>⛓ Chain: ${tweet.chainId} 🕒 ${new Date(tweet.timestamp * 1000).toLocaleString()}</small>
      `
            tweetList.appendChild(div)
        })
    }

    return {
        loadCachedTweets,
        fetchAndUpdateTweets,
    }
})()
