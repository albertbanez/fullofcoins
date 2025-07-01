// abi.js

// This file defines the single, authoritative ABI for the entire application.
// It is placed on the global `window` object to be accessible by all other scripts.

window.fullTweetContractAbi = [
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
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: 'address',
                name: 'follower',
                type: 'address',
            },
            {
                indexed: true,
                internalType: 'address',
                name: 'followed',
                type: 'address',
            },
        ],
        name: 'UserFollowed',
        type: 'event',
    },
    {
        anonymous: false,
        inputs: [
            {
                indexed: true,
                internalType: 'address',
                name: 'follower',
                type: 'address',
            },
            {
                indexed: true,
                internalType: 'address',
                name: 'followed',
                type: 'address',
            },
        ],
        name: 'UserUnfollowed',
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
        inputs: [
            { internalType: 'address', name: '_userToFollow', type: 'address' },
        ],
        name: 'follow',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
    {
        inputs: [{ internalType: 'address', name: '', type: 'address' }],
        name: 'followerCount',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [{ internalType: 'address', name: '', type: 'address' }],
        name: 'followingCount',
        outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [
            { internalType: 'address', name: '', type: 'address' },
            { internalType: 'address', name: '', type: 'address' },
        ],
        name: 'isFollowing',
        outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
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
            {
                internalType: 'address',
                name: '_userToUnfollow',
                type: 'address',
            },
        ],
        name: 'unfollow',
        outputs: [],
        stateMutability: 'nonpayable',
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
