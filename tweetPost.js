// tweetPost.js (Reverted to Image-Only)

// --- DOM Elements ---
const tweetInput = document.getElementById('tweetInput')
const postTweetBtn = document.getElementById('postTweetBtn')
const tweetMessage = document.getElementById('tweetMessage')
const attachImageBtn = document.getElementById('attachImageBtn')
const imageInput = document.getElementById('imageInput')
const imagePreviewContainer = document.getElementById('imagePreviewContainer')
const imagePreview = document.getElementById('imagePreview')
const removeImageBtn = document.getElementById('removeImageBtn')

// --- State Variables ---
let selectedFile = null
let uploadedImageCid = null

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
    tweetMessage.textContent = message
    tweetMessage.style.color = isSuccess ? '#28a745' : '#dc3545'
}

function resetComposer() {
    tweetInput.value = ''
    selectedFile = null
    uploadedImageCid = null
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

async function uploadFileAndGetCid(file) {
    showInlineMessage('Resizing image...', true)
    let resizedFile
    try {
        resizedFile = await resizeImage(file)
    } catch (err) {
        showInlineMessage('Image resize failed.', false)
        console.error('Resize error:', err)
        return null
    }

    showInlineMessage('Uploading image to IPFS...', true)
    const formData = new FormData()
    formData.append('file', resizedFile)

    try {
        const res = await fetch(
            'https://foc-lighthouse-uploader.fullofcoins.workers.dev',
            { method: 'POST', body: formData }
        )
        const data = await res.json()
        if (data.cid) {
            return data.cid // Return only the CID, not a structured string
        } else {
            showInlineMessage('Image upload failed.', false)
            console.error('Upload failed:', data)
            return null
        }
    } catch (err) {
        showInlineMessage('Network error during upload.', false)
        console.error('Upload error:', err)
        return null
    }
}

// --- Event Listeners ---
attachImageBtn.addEventListener('click', () => {
    imageInput.click()
})

imageInput.addEventListener('change', event => {
    const file = event.target.files[0]
    if (file) {
        selectedFile = file
        imagePreview.src = URL.createObjectURL(file)
        imagePreviewContainer.style.display = 'block'
    }
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

    if (selectedFile) {
        const cid = await uploadFileAndGetCid(selectedFile)
        if (!cid) {
            postTweetBtn.disabled = false
            return
        }
        uploadedImageCid = cid
    }

    showInlineMessage('Preparing transaction...', true)

    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum)
        const { chainId } = await provider.getNetwork()
        const targetChain = (window.chains || []).find(
            c => c.chainId === chainId
        )

        if (!targetChain) {
            showInlineMessage(`Unsupported network. Please switch.`, false)
            resetComposer()
            return
        }

        const signer = provider.getSigner()
        const contract = new ethers.Contract(
            targetChain.contractAddress,
            tweetAbi,
            signer
        )

        showInlineMessage('Please confirm in wallet...', true)
        await contract.callStatic.postTweet(tweetText, uploadedImageCid || '')
        const tx = await contract.postTweet(tweetText, uploadedImageCid || '')

        showInlineMessage('Posting tweet to blockchain...', true)
        await tx.wait()

        showInlineMessage('Tweet posted ✅', true)
        resetComposer()
        setTimeout(() => {
            tweetMessage.textContent = ''
        }, 5000)
    } catch (err) {
        console.error('Transaction failed:', err)
        let userMessage = 'Failed to post tweet ❌'
        if (err.message && err.message.includes('Cooldown')) {
            userMessage = 'Cooldown active. Please wait.'
        }
        showInlineMessage(userMessage, false)
        postTweetBtn.disabled = false
    }
})
