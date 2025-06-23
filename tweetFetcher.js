window.tweetFetcher = (() => {
    const abi = [
        'event TweetPosted(uint256 id, address indexed author, string content, uint256 timestamp, uint256 chainId)',
    ]

    const cacheKey = 'cachedTweets'
    let currentTweetMap = {}
    let newTweetsQueue = []

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

        const sorted = combined.sort(compareTweets) // newest on top
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

        const newOnly = sorted.filter(
            (tweet) => !currentTweetMap[`${tweet.chainId}-${tweet.id}`]
        )
        if (newOnly.length > 0) {
            newTweetsQueue = newOnly
            showNewPostsBanner(newOnly.length)
        }
    }

    function showNewPostsBanner(count) {
        const banner = document.getElementById('newPostsBanner')
        banner.innerHTML = `<button onclick="tweetFetcher.showNewTweets()">🔵 Show ${count} new post${count > 1 ? 's' : ''}</button>`
        banner.style.display = 'block'
    }

    function hideNewPostsBanner() {
        const banner = document.getElementById('newPostsBanner')
        banner.innerHTML = ''
        banner.style.display = 'none'
    }

    function showNewTweets() {
        const tweetList = document.getElementById('tweetList')

        // Sort newest first (descending), then insert in reverse order to keep newest on top
        newTweetsQueue.sort(compareTweets)
        for (let i = newTweetsQueue.length - 1; i >= 0; i--) {
            const tweet = newTweetsQueue[i]
            const div = document.createElement('div')
            div.className = 'tweet'
            div.innerHTML = `
      <strong>${tweet.author}</strong>
      <p>${tweet.content}</p>
      <small>⛓ Chain: ${tweet.chainId} • 🕒 ${new Date(tweet.timestamp * 1000).toLocaleString()}</small>
    `
            tweetList.insertBefore(div, tweetList.firstChild)
            currentTweetMap[`${tweet.chainId}-${tweet.id}`] = true
        }

        newTweetsQueue = []
        hideNewPostsBanner()
    }

    function renderTweets(tweets) {
        const tweetList = document.getElementById('tweetList')
        tweetList.innerHTML = ''
        currentTweetMap = {}

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
            currentTweetMap[`${tweet.chainId}-${tweet.id}`] = true
        })
    }

    function compareTweets(a, b) {
        if (b.blockNumber !== a.blockNumber)
            return b.blockNumber - a.blockNumber
        if (b.id !== a.id) return parseInt(b.id) - parseInt(a.id)
        return b.timestamp - a.timestamp
    }

    return {
        loadCachedTweets,
        fetchAndUpdateTweets,
        showNewTweets,
    }
})()
