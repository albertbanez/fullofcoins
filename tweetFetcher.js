window.tweetFetcher = (() => {
    const abi = [
        'event TweetPosted(uint256 id, address indexed author, string content, uint256 timestamp, uint256 chainId)',
    ]

    const cacheKey = 'cachedTweets'

    async function fetchTweetsForChain({
        rpcUrl,
        contractAddress,
        startBlock,
        chainId,
    }) {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
        const contract = new ethers.Contract(contractAddress, abi, provider)
        const latestBlock = await provider.getBlockNumber()

        let allTweets = []

        for (let from = startBlock; from <= latestBlock; from += 10000) {
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

                for (const log of logs) {
                    const parsed = contract.interface.parseLog(log)
                    const { id, author, content, timestamp, chainId } =
                        parsed.args

                    allTweets.push({
                        id: id.toString(),
                        author,
                        content,
                        timestamp: parseInt(timestamp),
                        chainId: parseInt(chainId),
                    })
                }
            } catch (err) {
                console.warn(
                    `Block range ${from}-${to} on chain ${chainId} failed:`,
                    err.message
                )
            }
        }

        return allTweets
    }

    function loadCachedTweets() {
        const raw = localStorage.getItem(cacheKey)
        if (!raw) return

        try {
            const cache = JSON.parse(raw)
            let tweets = Object.values(cache)
                .flat()
                .reduce((map, tweet) => {
                    map[`${tweet.chainId}-${tweet.id}`] = tweet
                    return map
                }, {})

            renderTweets(
                Object.values(tweets).sort((a, b) => b.timestamp - a.timestamp)
            )
        } catch (err) {
            console.warn('Failed to parse cached tweets:', err)
        }
    }

    async function fetchAndUpdateTweets(chains) {
        const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}')
        let combinedTweets = []

        for (const chain of chains) {
            const freshTweets = await fetchTweetsForChain(chain)
            cache[chain.chainId] = freshTweets
            combinedTweets = combinedTweets.concat(freshTweets)
        }

        localStorage.setItem(cacheKey, JSON.stringify(cache))

        // Deduplicate and sort
        const finalTweets = Object.values(
            combinedTweets.reduce((map, tweet) => {
                map[`${tweet.chainId}-${tweet.id}`] = tweet
                return map
            }, {})
        ).sort((a, b) => b.timestamp - a.timestamp)

        renderTweets(finalTweets)
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
