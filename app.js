const connectBtn = document.getElementById('connectBtn')
const walletAddressDiv = document.getElementById('walletAddress')
const walletModal = document.getElementById('walletModal')
const metamaskBtn = document.getElementById('metamaskBtn')
const closeModal = document.getElementById('closeModal')

let provider
let signer
let connectedAddress = null

if (window.ethereum) {
    window.ethereum.on('accountsChanged', async (accounts) => {
        if (accounts.length > 0) {
            try {
                provider = new ethers.providers.Web3Provider(window.ethereum)
                signer = provider.getSigner()
                window.provider = provider
                window.signer = signer

                connectedAddress = await signer.getAddress()

                localStorage.setItem('walletConnected', 'true')
                updateUIAfterConnect(connectedAddress)
                walletModal.style.display = 'none'
                document.body.classList.remove('modal-open')
                showToast('Wallet connected ✅', true)
            } catch (err) {
                console.error('Error during accountsChanged connect:', err)
                showToast('Failed to connect wallet ❌', false)
            }
        } else {
            logoutWallet()
        }
    })

    window.ethereum.on('connect', async () => {
        try {
            provider = new ethers.providers.Web3Provider(window.ethereum)
            const accounts = await provider.listAccounts()
            if (accounts.length > 0 && !connectedAddress) {
                signer = provider.getSigner()
                window.provider = provider
                window.signer = signer

                connectedAddress = await signer.getAddress()

                localStorage.setItem('walletConnected', 'true')
                updateUIAfterConnect(connectedAddress)
                walletModal.style.display = 'none'
                document.body.classList.remove('modal-open')
                showToast('Wallet connected ✅', true)
            }
        } catch (err) {
            console.error('Error during connect event:', err)
        }
    })
}

window.addEventListener('DOMContentLoaded', async () => {
    if (window.ethereum && localStorage.getItem('walletConnected') === 'true') {
        try {
            provider = new ethers.providers.Web3Provider(window.ethereum)
            await provider.send('eth_requestAccounts', [])
            signer = provider.getSigner()
            window.provider = provider
            window.signer = signer

            connectedAddress = await signer.getAddress()
            updateUIAfterConnect(connectedAddress)
            showToast('Wallet reconnected ✅', true)
        } catch (err) {
            console.warn('Auto-reconnect failed:', err)
            logoutWallet()
            showToast('Failed to reconnect wallet ❌', false)
        }
    }
})

// Handle Connect Wallet button
connectBtn.addEventListener('click', () => {
    if (connectedAddress) {
        logoutWallet()
        document.body.classList.remove('modal-open')
    } else {
        walletModal.style.display = 'flex'
        document.body.classList.add('modal-open')
    }
})

// Handle Close Modal button
closeModal.addEventListener('click', () => {
    walletModal.style.display = 'none'
    document.body.classList.remove('modal-open')
})

// Handle MetaMask connect
metamaskBtn.addEventListener('click', async () => {
    if (connectedAddress) {
        walletModal.style.display = 'none'
        document.body.classList.remove('modal-open')
        return
    }

    if (typeof window.ethereum === 'undefined') {
        const isMobile =
            /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
                navigator.userAgent
            )
        if (isMobile) {
            window.location.href =
                'https://metamask.app.link/dapp/fullofcoins.com'
        } else {
            alert(
                'MetaMask not installed. Please install MetaMask to continue.'
            )
            window.open('https://metamask.io/download.html', '_blank')
        }
        return
    }

    try {
        provider = new ethers.providers.Web3Provider(window.ethereum)
        await provider.send('eth_requestAccounts', [])
        signer = provider.getSigner()
        window.provider = provider
        window.signer = signer

        connectedAddress = await signer.getAddress()

        localStorage.setItem('walletConnected', 'true')
        updateUIAfterConnect(connectedAddress)
        walletModal.style.display = 'none'
        document.body.classList.remove('modal-open')
        showToast('Wallet connected ✅', true)
    } catch (err) {
        console.error('Wallet connection error:', err)
        showToast('Failed to connect wallet ❌', false)
    }
})

function updateUIAfterConnect(address) {
    connectBtn.textContent = `${shortenAddress(address)} (Logout)`
    walletAddressDiv.textContent = `Connected: ${address}`
}

function logoutWallet() {
    connectedAddress = null
    connectBtn.textContent = 'Connect Wallet'
    walletAddressDiv.textContent = ''
    localStorage.removeItem('walletConnected')
    document.body.classList.remove('modal-open')
    showToast('Wallet disconnected 🔌', false)
}

function shortenAddress(address) {
    return address.slice(0, 6) + '...' + address.slice(-4)
}

function showToast(message, isSuccess = true) {
    const toast = document.getElementById('toast')
    toast.textContent = message
    toast.style.backgroundColor = isSuccess ? '#28a745' : '#dc3545'
    toast.classList.add('show')
    setTimeout(() => {
        toast.classList.remove('show')
    }, 3000)
}
