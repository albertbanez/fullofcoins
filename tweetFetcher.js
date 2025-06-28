window.tweetFetcher = (() => {
    const abi = [
        'event TweetPosted(uint256 id, address indexed author, string content, string imageCid, uint256 timestamp, uint256 chainId)',
    ]
    const cacheKey = 'cachedTweets'
    let allSortedTweets = []
    let currentOffset = 0
    const BATCH_SIZE = 10

    let pendingNewTweets = []
    let newPostsBanner = null
    let showNewPostsBtn = null
    let tweetList = null

    function loadCache() {
        const raw = localStorage.getItem(cacheKey)
        return raw ? JSON.parse(raw) : {}
    }

    function saveCache(data) {
        const maxTotalTweets = 500
        const allTweets = []
        for (const chainId in data) {
            const tweets = data[chainId].tweets || []
            tweets.forEach(tweet =>
                allTweets.push({ ...tweet, _chainId: chainId })
            )
        }
        allTweets.sort(compareTweets)
        const trimmed = allTweets.slice(0, maxTotalTweets)
        const grouped = {}
        trimmed.forEach(tweet => {
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

        // ✅ Ensure fromBlock is not in the future
        let fromBlock = Math.min(startBlock, latestBlock)

        const allTweets = []
        let finalScannedBlock = fromBlock - 1

        for (let from = fromBlock; from <= latestBlock; from += 10000) {
            const to = Math.min(from + 9999, latestBlock)
            try {
                const logs = await provider.getLogs({
                    address: contractAddress,
                    fromBlock: from,
                    toBlock: to,
                    topics: [contract.interface.getEventTopic('TweetPosted')],
                })
                const parsedLogs = logs.map(log => {
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

    async function smartFetchTweets(chain, previousLastBlock) {
        const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl)
        const latestBlock = await provider.getBlockNumber()

        const effectiveLastBlock =
            previousLastBlock !== undefined && previousLastBlock !== null
                ? previousLastBlock
                : chain.startBlock

        const delta = latestBlock - effectiveLastBlock

        let fromBlock
        if (!previousLastBlock || delta > 500) {
            fromBlock = Math.max(latestBlock - 9999, chain.startBlock)
        } else {
            fromBlock = previousLastBlock + 1
        }

        // ✅ Ensure we do not go beyond latest block
        fromBlock = Math.min(fromBlock, latestBlock)

        const result = await fetchTweetsForChain({
            ...chain,
            startBlock: fromBlock,
        })

        return { ...result, actualLatestBlock: latestBlock }
    }

    function compareTweets(a, b) {
        if (b.blockNumber !== a.blockNumber)
            return b.blockNumber - a.blockNumber
        const aId = parseInt(a.id),
            bId = parseInt(b.id)
        if (bId !== aId) return bId - aId
        return b.timestamp - a.timestamp
    }

    function escapeHTML(str) {
        const p = document.createElement('p')
        p.appendChild(document.createTextNode(str))
        return p.innerHTML
    }

    function createTweetElement(tweet) {
        const div = document.createElement('div')
        div.className = 'tweet'
        div.setAttribute('data-tweet-id', `${tweet.chainId}-${tweet.id}`)
        div.innerHTML = `<strong>${tweet.author}</strong><p>${escapeHTML(
            tweet.content
        )}</p><small>⛓ Chain: ${tweet.chainId} • 🕒 ${new Date(
            tweet.timestamp * 1000
        ).toLocaleString()}</small>`
        return div
    }

    function refreshAllSortedTweetsFromCache() {
        const cache = loadCache()
        const combined = []
        Object.values(cache).forEach(chainData =>
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
        nextBatch.forEach(tweet =>
            fragment.appendChild(createTweetElement(tweet))
        )
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

        // Merge and deduplicate
        allSortedTweets = [...pendingNewTweets, ...allSortedTweets]
        allSortedTweets = Object.values(
            allSortedTweets.reduce((map, tweet) => {
                map[`${tweet.chainId}-${tweet.id}`] = tweet
                return map
            }, {})
        ).sort(compareTweets)

        // Clear entire list (removes "no tweets" msg if present)
        tweetList.innerHTML = ''
        currentOffset = 0
        renderNextBatch()

        // Cleanup
        pendingNewTweets = []
        newPostsBanner.style.display = 'none'
    }
    async function fetchAndUpdateTweets(chains) {
        const cache = loadCache()
        let hasNewTweets = false

        for (const chain of chains) {
            const chainId = chain.chainId.toString()
            const previousLastBlock =
                cache[chainId]?.lastScannedBlock || chain.startBlock

            try {
                const { tweets: freshTweets, lastScannedBlock } =
                    await smartFetchTweets(chain, previousLastBlock)
                if (freshTweets.length > 0) hasNewTweets = true
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
                    lastScannedBlock: lastScannedBlock ?? previousLastBlock,
                }
            } catch (err) {
                console.warn(`Error scanning chain ${chainId}:`, err)
            }
        }

        saveCache(cache)
        if (hasNewTweets) checkForNewTweets()
    }

    function checkForNewTweets() {
        const cache = loadCache()
        const combinedFromCache = []
        Object.values(cache).forEach(chainData =>
            combinedFromCache.push(...(chainData.tweets || []))
        )
        combinedFromCache.sort(compareTweets)
        const displayedIds = new Set(
            allSortedTweets.map(t => `${t.chainId}-${t.id}`)
        )
        const newTweetsFromCache = combinedFromCache.filter(
            t => !displayedIds.has(`${t.chainId}-${t.id}`)
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
                if (!tweetList || tweetList.children.length === 0) return
                const lastTweet = tweetList.lastElementChild
                if (!lastTweet) return
                const rect = lastTweet.getBoundingClientRect()
                if (rect.top <= window.innerHeight + 300) {
                    renderNextBatch()
                }
            }, 100)
        })
    }

    return {
        init,
        loadCachedTweets: renderInitialTweets,
        fetchAndUpdateTweets,
        checkForNewTweets,
    }
})()
