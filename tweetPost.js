const tweetInput = document.getElementById('tweetInput')
const postTweetBtn = document.getElementById('postTweetBtn')

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
    // Add any other ABI entries if needed
]

postTweetBtn.addEventListener('click', async () => {
    const tweetText = tweetInput.value.trim()
    if (!tweetText) {
        alert('Tweet cannot be empty.')
        return
    }

    if (!window.ethereum || !window.signer) {
        alert('Please connect your wallet first.')
        return
    }

    console.log('Preparing to post tweet:', tweetText)

    let currentNetwork
    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum)
        currentNetwork = await provider.getNetwork()
        console.log('Current chainId:', currentNetwork.chainId)
    } catch (err) {
        console.error('Network detection failed:', err)
        alert('Failed to detect network.')
        return
    }

    const chains = window.chains || []
    const matchedChain = chains.find(
        (c) => c.chainId === currentNetwork.chainId
    )
    const fallbackChain = chains.find((c) => c.chainId === 11155111) // Sepolia
    const targetChain = matchedChain || fallbackChain

    if (!targetChain) {
        alert('No supported chain is available.')
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
        showToast('Posting tweet...', true)

        await tx.wait()
        console.log('Transaction confirmed')
        tweetInput.value = ''
        showToast('Tweet posted ✅', true)
    } catch (err) {
        console.error('Transaction failed:', err)

        // Default error message
        let userMessage = 'Failed to post tweet ❌'

        // Try to detect the revert reason from the error object
        if (err.error && err.error.message) {
            if (err.error.message.includes('Cooldown')) {
                userMessage =
                    'Cooldown active: Please wait before posting again.'
            }
        } else if (err.message) {
            if (err.message.includes('Cooldown')) {
                userMessage =
                    'Cooldown active: Please wait before posting again.'
            }
        }

        showToast(userMessage, false)
    }
})

// You can keep your existing showToast function or add one here:
function showToast(message, isSuccess = true) {
    const toast = document.getElementById('toast')
    toast.textContent = message
    toast.style.backgroundColor = isSuccess ? '#28a745' : '#dc3545'
    toast.classList.add('show')
    setTimeout(() => {
        toast.classList.remove('show')
    }, 3000)
}
