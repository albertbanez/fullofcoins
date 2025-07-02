// tweetFetcher.js (Final, Complete Version)

window.tweetFetcher = (() => {
    // --- State and Config ---
    let chainInfoMap = new Map()
    const ENABLE_BACKGROUND_BACKFILL = true
    const tweetCacheKey = 'cachedTweets_v3'
    const followCacheKey = 'cachedFollows_v1'

    let allSortedTweets = []
    let userFollows = new Map()
    let currentFeedTweets = []
    let currentActiveTab = 'forYou'

    let currentOffset = 0
    const BATCH_SIZE = 10
    const BACKFILL_CHUNK_SIZE = 5000
    const BACKFILL_INTERVAL = 10000
    let newPostsBanner = null
    let showNewPostsBtn = null
    let tweetList = null
    let isBackfilling = false

    // --- Cache Management ---
    function loadTweetCache() {
        const raw = localStorage.getItem(tweetCacheKey)
        return raw ? JSON.parse(raw) : {}
    }
    function saveTweetCache(data) {
        const maxTotalTweets = 500
        const allTweets = []
        for (const chainId in data) {
            if (data[chainId] && data[chainId].scannedRanges) {
                data[chainId].scannedRanges = mergeRanges(
                    data[chainId].scannedRanges
                )
            }
            const tweets = (data[chainId] && data[chainId].tweets) || []
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
                    scannedRanges: (data[cid] && data[cid].scannedRanges) || [],
                }
            }
            delete tweet._chainId
            grouped[cid].tweets.push(tweet)
        })
        for (const chainId in data) {
            if (!grouped[chainId]) {
                grouped[chainId] = {
                    tweets: [],
                    scannedRanges:
                        (data[chainId] && data[chainId].scannedRanges) || [],
                }
            }
        }
        try {
            localStorage.setItem(tweetCacheKey, JSON.stringify(grouped))
        } catch (err) {
            console.warn(
                '⚠️ localStorage full or error saving tweet cache:',
                err
            )
        }
    }
    function loadFollowCache() {
        const raw = localStorage.getItem(followCacheKey)
        const data = raw ? JSON.parse(raw) : {}
        const map = new Map()
        for (const address in data) {
            map.set(address, {
                following: new Set(data[address].following),
                followers: new Set(data[address].followers),
            })
        }
        return map
    }
    function saveFollowCache(followMap) {
        const obj = {}
        for (const [address, data] of followMap.entries()) {
            obj[address] = {
                following: Array.from(data.following),
                followers: Array.from(data.followers),
            }
        }
        try {
            localStorage.setItem(followCacheKey, JSON.stringify(obj))
        } catch (err) {
            console.warn(
                '⚠️ localStorage full or error saving follow cache:',
                err
            )
        }
    }
    function mergeRanges(ranges) {
        if (!ranges || ranges.length < 2) return ranges || []
        ranges.sort((a, b) => a.from - b.from)
        const merged = [ranges[0]]
        for (let i = 1; i < ranges.length; i++) {
            const last = merged[merged.length - 1]
            const current = ranges[i]
            if (current.from <= last.to + 1) {
                last.to = Math.max(last.to, current.to)
            } else {
                merged.push(current)
            }
        }
        return merged
    }

    // --- Fetching Logic ---
    async function fetchEventsForRange({
        rpcUrl,
        contractAddress,
        fromBlock,
        toBlock,
    }) {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
        const contract = new ethers.Contract(
            contractAddress,
            window.fullTweetContractAbi,
            provider
        )
        const allEvents = []
        for (let from = fromBlock; from <= toBlock; from += 10000) {
            const to = Math.min(from + 9999, toBlock)
            try {
                const logs = await provider.getLogs({
                    address: contractAddress,
                    fromBlock: from,
                    toBlock: to,
                    topics: [
                        [
                            contract.interface.getEventTopic('TweetPosted'),
                            contract.interface.getEventTopic('TweetLiked'),
                            contract.interface.getEventTopic('TweetUnliked'),
                            contract.interface.getEventTopic('UserFollowed'),
                            contract.interface.getEventTopic('UserUnfollowed'),
                        ],
                    ],
                })
                const parsedEvents = logs
                    .map(log => {
                        try {
                            return {
                                ...contract.interface.parseLog(log),
                                blockNumber: log.blockNumber,
                                logIndex: log.logIndex,
                            }
                        } catch (e) {
                            return null
                        }
                    })
                    .filter(e => e !== null)
                allEvents.push(...parsedEvents)
            } catch (err) {
                console.warn(`Failed to fetch logs from ${from} to ${to}:`, err)
                return []
            }
        }
        return allEvents
    }
    function processEvents(events, existingTweets, existingFollows, chainId) {
        const tweetMap = new Map(
            existingTweets.map(t => [`${t.chainId}-${t.id}`, t])
        )
        const userFollowsMap = existingFollows || new Map()
        const getProfile = addr => {
            if (!userFollowsMap.has(addr))
                userFollowsMap.set(addr, {
                    following: new Set(),
                    followers: new Set(),
                })
            return userFollowsMap.get(addr)
        }
        events.sort(
            (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex
        )
        for (const event of events) {
            const { name, args } = event
            if (name === 'TweetPosted') {
                const tweet = {
                    id: args.id.toString(),
                    author: args.author,
                    content: args.content,
                    imageCid: args.imageCid,
                    timestamp: parseInt(args.timestamp),
                    chainId: parseInt(args.chainId),
                    blockNumber: event.blockNumber,
                    likeCount: 0,
                    likers: new Set(),
                }
                tweetMap.set(`${tweet.chainId}-${tweet.id}`, tweet)
            } else if (name === 'TweetLiked') {
                const tweet = tweetMap.get(
                    `${chainId}-${args.tweetId.toString()}`
                )
                if (tweet && !tweet.likers.has(args.user)) {
                    tweet.likers.add(args.user)
                    tweet.likeCount = tweet.likers.size
                }
            } else if (name === 'TweetUnliked') {
                const tweet = tweetMap.get(
                    `${chainId}-${args.tweetId.toString()}`
                )
                if (tweet && tweet.likers.has(args.user)) {
                    tweet.likers.delete(args.user)
                    tweet.likeCount = tweet.likers.size
                }
            } else if (name === 'UserFollowed') {
                getProfile(args.follower).following.add(args.followed)
                getProfile(args.followed).followers.add(args.follower)
            } else if (name === 'UserUnfollowed') {
                getProfile(args.follower).following.delete(args.followed)
                getProfile(args.followed).followers.delete(args.follower)
            }
        }
        const finalTweets = Array.from(tweetMap.values())
        finalTweets.forEach(t => (t.likers = Array.from(t.likers)))
        return { tweets: finalTweets, follows: userFollowsMap }
    }
    async function fetchAndUpdateTweets(chains) {
        const tweetCache = loadTweetCache()
        const followCache = loadFollowCache()
        let hasNewData = false
        for (const chain of chains) {
            const chainIdStr = chain.chainId.toString()
            const provider = new ethers.providers.JsonRpcProvider(chain.rpcUrl)
            const latestBlock = await provider.getBlockNumber()
            if (!tweetCache[chainIdStr])
                tweetCache[chainIdStr] = { tweets: [], scannedRanges: [] }
            const scannedRanges = tweetCache[chainIdStr].scannedRanges || []
            const highestRange = scannedRanges.reduce(
                (max, r) => (r.to > max.to ? r : max),
                { from: 0, to: 0 }
            )
            const lastScannedBlock = highestRange.to || chain.startBlock
            const delta = latestBlock - lastScannedBlock
            let fetchFrom, fetchTo
            if (delta > 500) {
                fetchFrom = Math.max(latestBlock - 9999, chain.startBlock)
                fetchTo = latestBlock
            } else if (delta > 0) {
                fetchFrom = lastScannedBlock + 1
                fetchTo = latestBlock
            } else {
                continue
            }
            const freshEvents = await fetchEventsForRange({
                ...chain,
                fromBlock: fetchFrom,
                toBlock: fetchTo,
            })
            if (freshEvents.length > 0) {
                hasNewData = true
                const existingTweets = (
                    tweetCache[chainIdStr]?.tweets || []
                ).map(t => ({ ...t, likers: new Set(t.likers) }))
                const { tweets: updatedTweets, follows: updatedFollows } =
                    processEvents(
                        freshEvents,
                        existingTweets,
                        followCache,
                        chain.chainId
                    )
                tweetCache[chainIdStr].tweets = updatedTweets
                userFollows = updatedFollows
            }
            if (!tweetCache[chainIdStr].scannedRanges)
                tweetCache[chainIdStr].scannedRanges = []
            tweetCache[chainIdStr].scannedRanges.push({
                from: fetchFrom,
                to: fetchTo,
            })
        }
        saveTweetCache(tweetCache)
        saveFollowCache(userFollows)
        if (hasNewData) {
            checkForNewTweets()
        }
        if (ENABLE_BACKGROUND_BACKFILL) startBackgroundBackfill(chains)
    }
    async function startBackgroundBackfill(chains) {
        if (isBackfilling) return
        isBackfilling = true
        const backfillLoop = async () => {
            const tweetCache = loadTweetCache()
            const followCache = loadFollowCache()
            let gapFound = false
            for (const chain of chains) {
                const chainIdStr = chain.chainId.toString()
                const chainData = tweetCache[chainIdStr]
                if (!chainData || !chainData.scannedRanges) continue
                const ranges = mergeRanges(chainData.scannedRanges)
                let highestGap = { size: 0, from: 0, to: 0 }
                let lastTo = chain.startBlock
                for (const range of ranges) {
                    const gapSize = range.from - lastTo
                    if (gapSize > highestGap.size) {
                        highestGap = {
                            size: gapSize,
                            from: lastTo + 1,
                            to: range.from - 1,
                        }
                    }
                    lastTo = range.to
                }
                if (highestGap.size > 1) {
                    gapFound = true
                    const from = Math.max(
                        highestGap.from,
                        highestGap.to - BACKFILL_CHUNK_SIZE + 1
                    )
                    const to = highestGap.to
                    const filledEvents = await fetchEventsForRange({
                        ...chain,
                        fromBlock: from,
                        toBlock: to,
                    })
                    if (filledEvents.length > 0) {
                        const currentTweetCache = loadTweetCache()
                        const currentFollowCache = loadFollowCache()
                        const existingTweets = (
                            currentTweetCache[chainIdStr]?.tweets || []
                        ).map(t => ({ ...t, likers: new Set(t.likers) }))
                        const {
                            tweets: updatedTweets,
                            follows: updatedFollows,
                        } = processEvents(
                            filledEvents,
                            existingTweets,
                            currentFollowCache,
                            chain.chainId
                        )
                        currentTweetCache[chainIdStr].tweets = updatedTweets
                        if (!currentTweetCache[chainIdStr].scannedRanges)
                            currentTweetCache[chainIdStr].scannedRanges = []
                        currentTweetCache[chainIdStr].scannedRanges.push({
                            from,
                            to,
                        })
                        saveTweetCache(currentTweetCache)
                        saveFollowCache(updatedFollows)
                        renderInitialTweets()
                    } else {
                        const currentTweetCache = loadTweetCache()
                        if (!currentTweetCache[chainIdStr])
                            currentTweetCache[chainIdStr] = {
                                tweets: [],
                                scannedRanges: [],
                            }
                        currentTweetCache[chainIdStr].scannedRanges.push({
                            from,
                            to,
                        })
                        saveTweetCache(currentTweetCache)
                    }
                    break
                }
            }
            if (gapFound) {
                setTimeout(backfillLoop, BACKFILL_INTERVAL)
            } else {
                isBackfilling = false
            }
        }
        setTimeout(backfillLoop, 5000)
    }

    // --- Rendering Logic ---
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
        let imageHtml = ''
        if (
            tweet.imageCid &&
            (tweet.imageCid.startsWith('Qm') ||
                tweet.imageCid.startsWith('baf'))
        ) {
            const imageUrl = `https://ipfs.io/ipfs/${tweet.imageCid}`
            imageHtml = `<a href="${imageUrl}" target="_blank" rel="noopener noreferrer"><img src="${imageUrl}" alt="Tweet image" class="tweet-image" /></a>`
        }
        const chainName = chainInfoMap.get(tweet.chainId)?.name || tweet.chainId
        const date = new Date(tweet.timestamp * 1000)
        const formattedDate = new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        }).format(date)
        const formattedTime = new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            hour12: true,
        }).format(date)
        const finalDateTimeString = `${formattedDate}, ${formattedTime}`
        let userHasLiked = false
        if (window.connectedAddress) {
            const likers = new Set(
                (tweet.likers || []).map(l => l.toLowerCase())
            )
            userHasLiked = likers.has(window.connectedAddress.toLowerCase())
        }
        let showFollowButton = false
        let isFollowing = false
        if (
            window.connectedAddress &&
            window.connectedAddress.toLowerCase() !== tweet.author.toLowerCase()
        ) {
            showFollowButton = true
            const myProfile = userFollows.get(window.connectedAddress)
            if (myProfile) {
                isFollowing = myProfile.following.has(tweet.author)
            }
        }
        const followButtonHtml = showFollowButton
            ? `<button class="follow-btn ${isFollowing ? 'following' : ''}" data-author="${tweet.author}" data-chain-id="${tweet.chainId}"><span>${isFollowing ? 'Following' : 'Follow'}</span></button>`
            : ''
        const likeButtonHtml = `<button class="like-btn ${userHasLiked ? 'liked' : ''}" data-tweet-id="${tweet.id}" data-chain-id="${tweet.chainId}"><span class="icon">${userHasLiked ? '❤️' : '🤍'}</span><span class="count">${tweet.likeCount || 0}</span></button>`
        div.innerHTML = `<div class="tweet-header"><strong class="tweet-author">${tweet.author}</strong>${followButtonHtml}</div><p>${escapeHTML(tweet.content)}</p>${imageHtml}<small>⛓ Chain: ${chainName} • 🕒 ${finalDateTimeString}</small><div class="tweet-actions">${likeButtonHtml}</div>`
        return div
    }

    // --- UI and Init Functions ---
    function refreshAllSortedTweetsFromCache() {
        const cache = loadTweetCache()
        const combined = []
        Object.values(cache).forEach(chainData => {
            if (chainData && chainData.tweets) {
                combined.push(...chainData.tweets)
            }
        })
        allSortedTweets = combined.sort(compareTweets)
    }
    function filterTweetsForFeed() {
        if (currentActiveTab === 'following') {
            if (!window.connectedAddress) {
                currentFeedTweets = []
                return
            }
            const myProfile = userFollows.get(window.connectedAddress)
            const followingSet = myProfile ? myProfile.following : new Set()
            currentFeedTweets = allSortedTweets.filter(
                tweet =>
                    followingSet.has(tweet.author) ||
                    tweet.author.toLowerCase() ===
                        window.connectedAddress.toLowerCase()
            )
        } else {
            currentFeedTweets = allSortedTweets
        }
    }
    function renderNextBatch() {
        if (currentOffset >= currentFeedTweets.length) return
        const fragment = document.createDocumentFragment()
        const nextBatch = currentFeedTweets.slice(
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
        filterTweetsForFeed()
        if (currentFeedTweets.length === 0) {
            const message =
                currentActiveTab === 'following' && window.connectedAddress
                    ? 'Your following feed is empty. Find accounts to follow!'
                    : currentActiveTab === 'following' &&
                        !window.connectedAddress
                      ? 'Connect your wallet to see tweets from accounts you follow.'
                      : 'No tweets found on-chain yet.'
            tweetList.innerHTML = `<p style="opacity: 0.6; padding: 20px; text-align: center;">${message}</p>`
            return
        }
        renderNextBatch()
    }

    function checkForNewTweets() {
        const displayedTweetIds = new Set()
        document.querySelectorAll('#tweetList .tweet').forEach(el => {
            const tweetId = el.getAttribute('data-tweet-id')
            if (tweetId) displayedTweetIds.add(tweetId)
        })
        refreshAllSortedTweetsFromCache()
        const newTweets = allSortedTweets.filter(
            t => !displayedTweetIds.has(`${t.chainId}-${t.id}`)
        )
        if (newTweets.length > 0) {
            showNewPostsBtn.textContent = `Show ${newTweets.length} new post${newTweets.length > 1 ? 's' : ''}`
            newPostsBanner.style.display = 'block'
        }
    }

    function init() {
        chainInfoMap = new Map((window.chains || []).map(c => [c.chainId, c]))
        userFollows = loadFollowCache()

        newPostsBanner = document.getElementById('newPostsBanner')
        showNewPostsBtn = document.getElementById('showNewPostsBtn')
        tweetList = document.getElementById('tweetList')

        const forYouTab = document.getElementById('forYouTab')
        const followingTab = document.getElementById('followingTab')

        if (forYouTab && followingTab) {
            forYouTab.addEventListener('click', () => {
                if (currentActiveTab === 'forYou') return
                currentActiveTab = 'forYou'
                forYouTab.classList.add('active')
                followingTab.classList.remove('active')
                if (newPostsBanner) newPostsBanner.style.display = 'none'
                renderInitialTweets()
            })
            followingTab.addEventListener('click', () => {
                if (currentActiveTab === 'following') return
                currentActiveTab = 'following'
                followingTab.classList.add('active')
                forYouTab.classList.remove('active')
                if (newPostsBanner) newPostsBanner.style.display = 'none'
                renderInitialTweets()
            })
        }
        if (showNewPostsBtn) {
            showNewPostsBtn.addEventListener('click', () => {
                renderInitialTweets()
                if (newPostsBanner) {
                    newPostsBanner.style.display = 'none'
                }
            })
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

    function refreshUI() {
        userFollows = loadFollowCache()
        renderInitialTweets()
    }

    return {
        init,
        loadCachedTweets: renderInitialTweets,
        fetchAndUpdateTweets,
        refreshUI,
    }
})()
