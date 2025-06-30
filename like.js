// like.js

// This file handles the on-chain "like" and "unlike" interactions.

const fullTweetContractAbi = [
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: 'uint256',
                name: 'tweetId',
                type: 'uint256',
            },
            {
                indexed: true,
                internalType: 'address',
                name: 'user',
                type: 'address',
            },
        ],
        name: 'TweetLiked',
        type: 'event',
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: false,
                internalType: 'uint256',
                name: 'id',
                type: 'uint256',
            },
            {
                indexed: true,
                internalType: 'address',
                name: 'author',
                type: 'address',
            },
            {
                indexed: false,
                internalType: 'string',
                name: 'content',
                type: 'string',
            },
            {
                indexed: false,
                internalType: 'string',
                name: 'imageCid',
                type: 'string',
            },
            {
                indexed: false,
                internalType: 'uint256',
                name: 'timestamp',
                type: 'uint256',
            },
            {
                indexed: false,
                internalType: 'uint256',
                name: 'chainId',
                type: 'uint256',
            },
        ],
        name: 'TweetPosted',
        type: 'event',
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: 'uint256',
                name: 'tweetId',
                type: 'uint256',
            },
            {
                indexed: true,
                internalType: 'address',
                name: 'user',
                type: 'address',
            },
        ],
        name: 'TweetUnliked',
        type: 'event',
    },
    {
        inputs: [],
        name: 'COOLDOWN_TIME',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [{ internalType: 'address', name: '', type: 'address' }],
        name: 'lastPostTime',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'uint256', name: '_tweetId', type: 'uint256' },
        ],
        name: 'likeTweet',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [],
        name: 'nextTweetId',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'string', name: '_content', type: 'string' },
            { internalType: 'string', name: '_imageCid', type: 'string' },
        ],
        name: 'postTweet',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        name: 'tweetLikeCount',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'uint256', name: '_tweetId', type: 'uint256' },
        ],
        name: 'unlikeTweet',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'uint256', name: '', type: 'uint256' },
            { internalType: 'address', name: '', type: 'address' },
        ],
        name: 'userHasLiked',
        outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
        stateMutability: 'view',
        type: 'function',
    },
]

document.addEventListener('DOMContentLoaded', () => {
    const tweetList = document.getElementById('tweetList')

    if (tweetList) {
        tweetList.addEventListener('click', async e => {
            // Use event delegation to find the like button
            const likeButton = e.target.closest('.like-btn')
            if (!likeButton) return

            if (!window.signer) {
                alert('Please connect your wallet to like a tweet.')
                return
            }

            const tweetId = likeButton.dataset.tweetId
            const chainId = likeButton.dataset.chainId
            const isLiked = likeButton.classList.contains('liked')

            // Find the contract address for this chain
            const chainConfig = (window.chains || []).find(
                c => c.chainId == chainId
            )
            if (!chainConfig) {
                alert('Cannot find contract for this chain.')
                return
            }

            // Optimistic UI update
            likeButton.disabled = true
            const icon = likeButton.querySelector('.icon')
            const countSpan = likeButton.querySelector('.count')
            let currentCount = parseInt(countSpan.textContent, 10)

            if (isLiked) {
                likeButton.classList.remove('liked')
                icon.textContent = '🤍'
                countSpan.textContent = currentCount - 1
            } else {
                likeButton.classList.add('liked')
                icon.textContent = '❤️'
                countSpan.textContent = currentCount + 1
            }

            try {
                const contract = new ethers.Contract(
                    chainConfig.contractAddress,
                    fullTweetContractAbi,
                    window.signer
                )
                const tx = isLiked
                    ? await contract.unlikeTweet(tweetId)
                    : await contract.likeTweet(tweetId)
                await tx.wait() // Wait for confirmation
                console.log(
                    `Tweet ${isLiked ? 'unliked' : 'liked'} successfully!`
                )
            } catch (err) {
                console.error('Like/Unlike transaction failed:', err)
                alert(`Action failed: ${err.reason || err.message}`)

                // Revert UI on failure
                if (isLiked) {
                    likeButton.classList.add('liked')
                    icon.textContent = '❤️'
                    countSpan.textContent = currentCount
                } else {
                    likeButton.classList.remove('liked')
                    icon.textContent = '🤍'
                    countSpan.textContent = currentCount
                }
            } finally {
                likeButton.disabled = false
            }
        })
    }
})
