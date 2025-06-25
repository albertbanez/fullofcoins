const tweetInput = document.getElementById('tweetInput')
const postTweetBtn = document.getElementById('postTweetBtn')
const tweetMessage = document.getElementById('tweetMessage')

// Full ABI including postTweet function and event
const tweetAbi = [
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
        inputs: [{ internalType: 'string', name: '_content', type: 'string' }],
        name: 'postTweet',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
]

function showInlineMessage(message, isSuccess = true) {
    tweetMessage.textContent = message
    tweetMessage.style.color = isSuccess ? '#28a745' : '#dc3545' // green or red
}

postTweetBtn.addEventListener('click', async () => {
    const tweetText = tweetInput.value.trim()
    if (!tweetText) {
        showInlineMessage('Tweet cannot be empty.', false)
        return
    }

    if (!window.ethereum || !window.signer) {
        showInlineMessage('Please connect your wallet first.', false)
        return
    }

    console.log('Preparing to post tweet:', tweetText)
    showInlineMessage('Posting tweet...', true)

    let currentNetwork
    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum)
        currentNetwork = await provider.getNetwork()
        console.log('Current chainId:', currentNetwork.chainId)
    } catch (err) {
        console.error('Network detection failed:', err)
        showInlineMessage('Failed to detect network.', false)
        return
    }

    const chains = window.chains || []
    const matchedChain = chains.find(
        (c) => c.chainId === currentNetwork.chainId
    )
    const fallbackChain = chains.find((c) => c.chainId === 11155111)
    const targetChain = matchedChain || fallbackChain

    if (!targetChain) {
        showInlineMessage('No supported chain is available.', false)
        return
    }

    console.log('Using contract at:', targetChain.contractAddress)

    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum)
        const signer = provider.getSigner()

        const contract = new ethers.Contract(
            targetChain.contractAddress,
            tweetAbi,
            provider
        )
        const contractWithSigner = contract.connect(signer)

        const tx = await contractWithSigner.postTweet(tweetText)
        console.log('Transaction sent:', tx.hash)

        await tx.wait()
        console.log('Transaction confirmed')
        tweetInput.value = ''
        showInlineMessage('Tweet posted ✅', true)

        setTimeout(() => {
            tweetMessage.textContent = ''
        }, 5000)
    } catch (err) {
        console.error('Transaction failed:', err)

        let userMessage = 'Failed to post tweet ❌'

        if (
            err.error &&
            err.error.message &&
            err.error.message.includes('Cooldown')
        ) {
            userMessage = 'Cooldown active: Please wait before posting again.'
        } else if (err.message && err.message.includes('Cooldown')) {
            userMessage = 'Cooldown active: Please wait before posting again.'
        }

        showInlineMessage(userMessage, false)
    }
})
