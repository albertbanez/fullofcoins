// tweetPost.js

// --- DOM Elements ---
const tweetInput = document.getElementById('tweetInput')
const postTweetBtn = document.getElementById('postTweetBtn')
const tweetMessage = document.getElementById('tweetMessage')
const attachImageBtn = document.getElementById('attachImageBtn')
const imageInput = document.getElementById('imageInput')
const imagePreviewContainer = document.getElementById('imagePreviewContainer')
const imagePreview = document.getElementById('imagePreview')
const removeImageBtn = document.getElementById('removeImageBtn')

// --- State and Config ---
let selectedFile = null
const MAX_FILE_SIZE_MB = 25
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

// --- Full ABI (Unchanged) ---
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
]

// --- Helper Functions ---
function showInlineMessage(message, isSuccess = true) {
    /* ... same as before ... */
}
function resetComposer() {
    /* ... same as before ... */
}
function resizeImage(file, maxWidth = 800, maxHeight = 800) {
    /* ... same as before ... */
}

async function processAndUploadFile(file) {
    let fileToUpload = file
    if (file.type === 'image/jpeg' || file.type === 'image/png') {
        showInlineMessage('Resizing image...', true)
        try {
            fileToUpload = await resizeImage(file)
        } catch (err) {
            showInlineMessage('Image resize failed.', false)
            return null
        }
    }

    showInlineMessage('Uploading to IPFS...', true)
    const formData = new FormData()
    formData.append('file', fileToUpload)

    try {
        const res = await fetch(
            'https://foc-lighthouse-uploader.fullofcoins.workers.dev',
            { method: 'POST', body: formData }
        )
        const data = await res.json()
        if (data.cid) {
            return `${data.cid}|${file.type}`
        } else {
            showInlineMessage('Upload failed.', false)
            return null
        }
    } catch (err) {
        showInlineMessage('Network error during upload.', false)
        return null
    }
}

// --- Event Listeners ---
attachImageBtn.addEventListener('click', () => {
    imageInput.click()
})

imageInput.addEventListener('change', event => {
    const file = event.target.files[0]
    if (!file) return

    if (file.size > MAX_FILE_SIZE_BYTES) {
        alert(`File is too large. Max size is ${MAX_FILE_SIZE_MB}MB.`)
        imageInput.value = ''
        return
    }
    selectedFile = file
    imagePreview.src = URL.createObjectURL(file)
    imagePreviewContainer.style.display = 'block'
})

removeImageBtn.addEventListener('click', () => {
    selectedFile = null
    imageInput.value = ''
    imagePreviewContainer.style.display = 'none'
    imagePreview.src = '#'
})

postTweetBtn.addEventListener('click', async () => {
    const tweetText = tweetInput.value.trim()
    if (!tweetText && !selectedFile) {
        showInlineMessage('Tweet cannot be empty.', false)
        return
    }
    if (!window.ethereum || !window.signer) {
        showInlineMessage('Please connect your wallet first.', false)
        return
    }

    postTweetBtn.disabled = true
    let finalCidString = ''

    if (selectedFile) {
        const result = await processAndUploadFile(selectedFile)
        if (!result) {
            postTweetBtn.disabled = false
            return
        }
        finalCidString = result
    }

    showInlineMessage('Preparing transaction...', true)
    const provider = new ethers.providers.Web3Provider(window.ethereum)
    const { chainId } = await provider.getNetwork()
    const targetChain = (window.chains || []).find(c => c.chainId === chainId)

    if (!targetChain) {
        showInlineMessage(`Unsupported network. Please switch.`, false)
        postTweetBtn.disabled = false
        return
    }

    // ==========================================================
    // DEBUGGER LOGS
    // ==========================================================
    console.log('--- DEBUGGING TRANSACTION ---')
    console.log('Connected to Chain ID:', chainId)
    console.log('Using Target Chain Config:', targetChain)
    console.log('Contract Address:', targetChain.contractAddress)
    console.log('Arguments to be sent:')
    console.log(`1. _content (string): "${tweetText}"`)
    console.log(`2. _imageCid (string): "${finalCidString}"`)
    console.log('Signer object:', window.signer)
    // ==========================================================

    try {
        const signer = provider.getSigner()
        const contract = new ethers.Contract(
            targetChain.contractAddress,
            tweetAbi,
            signer
        )

        showInlineMessage('Please confirm in wallet...', true)

        // ==========================================================
        // "DRY RUN" CHECK
        // This simulates the transaction to see if it will fail on-chain.
        // ==========================================================
        try {
            console.log('Attempting a dry run with callStatic...')
            await contract.callStatic.postTweet(tweetText, finalCidString)
            console.log(
                '%c✅ Dry run successful. The transaction should not revert.',
                'color: green; font-weight: bold;'
            )
        } catch (dryRunError) {
            console.error(
                '%c❌ Dry run FAILED. The transaction would revert on-chain.',
                'color: red; font-weight: bold;'
            )
            console.error('Reason for failure:', dryRunError)
            // Extract a more human-readable message if available
            const reason =
                dryRunError.reason ||
                dryRunError.data?.message ||
                dryRunError.message
            showInlineMessage(`Error: ${reason}`, false)
            postTweetBtn.disabled = false
            return // Stop execution here
        }
        // ==========================================================

        console.log('Dry run passed. Sending actual transaction...')
        const tx = await contract.postTweet(tweetText, finalCidString)

        showInlineMessage('Posting tweet to blockchain...', true)
        await tx.wait()

        showInlineMessage('Tweet posted ✅', true)
        resetComposer()
        setTimeout(() => {
            tweetMessage.textContent = ''
        }, 5000)
    } catch (err) {
        // This catch block will now likely handle user rejection from MetaMask
        console.error('Transaction failed (likely user rejection):', err)
        let userMessage = 'Failed to post tweet ❌'
        if (err.code === 4001) {
            // MetaMask user rejected the transaction
            userMessage = 'Transaction rejected in wallet.'
        }
        showInlineMessage(userMessage, false)
        postTweetBtn.disabled = false
    }
})

// Helper function implementations (unchanged)
function showInlineMessage(message, isSuccess = true) {
    tweetMessage.textContent = message
    tweetMessage.style.color = isSuccess ? '#28a745' : '#dc3545'
}
function resetComposer() {
    tweetInput.value = ''
    selectedFile = null
    imageInput.value = ''
    imagePreviewContainer.style.display = 'none'
    imagePreview.src = '#'
    postTweetBtn.disabled = false
}
function resizeImage(file, maxWidth = 800, maxHeight = 800) {
    return new Promise((resolve, reject) => {
        const img = new Image()
        const url = URL.createObjectURL(file)
        img.onload = () => {
            let { width, height } = img
            if (width > height && width > maxWidth) {
                height *= maxWidth / width
                width = maxWidth
            } else if (height > maxHeight) {
                width *= maxHeight / height
                height = maxHeight
            }
            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            const ctx = canvas.getContext('2d')
            ctx.drawImage(img, 0, 0, width, height)
            canvas.toBlob(
                blob => {
                    if (!blob) return reject('Compression failed')
                    resolve(new File([blob], file.name, { type: file.type }))
                    URL.revokeObjectURL(url)
                },
                file.type,
                0.85
            )
        }
        img.onerror = err => reject(err)
        img.src = url
    })
}
