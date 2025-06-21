const connectBtn = document.getElementById('connectBtn');
const walletAddressDiv = document.getElementById('walletAddress');
const walletModal = document.getElementById('walletModal');
const metamaskBtn = document.getElementById('metamaskBtn');
const closeModal = document.getElementById('closeModal');

let provider;
let signer;
let connectedAddress = null;

if (window.ethereum) {
  window.ethereum.on('accountsChanged', async (accounts) => {
    if (accounts.length > 0) {
      // Wallet was just unlocked or changed — connect automatically
      try {
        provider = new ethers.providers.Web3Provider(window.ethereum);
        signer = provider.getSigner();
        connectedAddress = await signer.getAddress();

        localStorage.setItem('walletConnected', 'true');
        updateUIAfterConnect(connectedAddress);
        walletModal.style.display = 'none';
        fetchTweetsFromChain(connectedAddress);
        showToast('Wallet connected ✅', true);
      } catch (err) {
        console.error('Error during accountsChanged connect:', err);
        showToast('Failed to connect wallet ❌', false);
      }
    } else {
      // Wallet was disconnected
      logoutWallet();
    }
  });
  
  // Add this new event listener for the connect event
  window.ethereum.on('connect', async () => {
    try {
      provider = new ethers.providers.Web3Provider(window.ethereum);
      const accounts = await provider.listAccounts();
      if (accounts.length > 0 && !connectedAddress) {
        signer = provider.getSigner();
        connectedAddress = await signer.getAddress();

        localStorage.setItem('walletConnected', 'true');
        updateUIAfterConnect(connectedAddress);
        walletModal.style.display = 'none';
        fetchTweetsFromChain(connectedAddress);
        showToast('Wallet connected ✅', true);
      }
    } catch (err) {
      console.error('Error during connect event:', err);
    }
  });
}

// Load on page refresh
window.addEventListener('DOMContentLoaded', async () => {
  if (window.ethereum && localStorage.getItem('walletConnected') === 'true') {
    try {
      provider = new ethers.providers.Web3Provider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      signer = provider.getSigner();
      connectedAddress = await signer.getAddress();
      updateUIAfterConnect(connectedAddress);
      fetchTweetsFromChain(connectedAddress);
      showToast('Wallet reconnected ✅', true);
    } catch (err) {
      console.warn('Auto-reconnect failed:', err);
      logoutWallet();
      showToast('Failed to reconnect wallet ❌', false);
    }
  }
});

// Show modal on connect button click
connectBtn.addEventListener('click', () => {
  if (connectedAddress) {
    logoutWallet();
  } else {
    walletModal.style.display = 'flex';
  }
});

// Close modal
closeModal.addEventListener('click', () => {
  walletModal.style.display = 'none';
});

// Connect with MetaMask (no network switching)
metamaskBtn.addEventListener('click', async () => {
  if (connectedAddress) {
    walletModal.style.display = 'none';
    return;
  }

  // Check if MetaMask is installed (desktop) or if it's a mobile browser
  if (typeof window.ethereum === 'undefined') {
    // Check if user is on a mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile) {
      // Try to open MetaMask mobile app or redirect to install page
      window.location.href = 'https://metamask.app.link/dapp/' + encodeURIComponent(window.location.href);
    } else {
      alert('MetaMask not installed. Please install MetaMask to continue.');
      window.open('https://metamask.io/download.html', '_blank');
    }
    return;
  }

  try {
    provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    signer = provider.getSigner();
    connectedAddress = await signer.getAddress();

    localStorage.setItem('walletConnected', 'true');
    updateUIAfterConnect(connectedAddress);
    walletModal.style.display = 'none';
    fetchTweetsFromChain(connectedAddress);
    showToast('Wallet connected ✅', true);
  } catch (err) {
    console.error('Wallet connection error:', err);
    showToast('Failed to connect wallet ❌', false);
  }
});

function updateUIAfterConnect(address) {
  connectBtn.textContent = `${shortenAddress(address)} (Logout)`;
  walletAddressDiv.textContent = `Connected: ${address}`;
}

function logoutWallet() {
  connectedAddress = null;
  connectBtn.textContent = 'Connect Wallet';
  walletAddressDiv.textContent = '';
  localStorage.removeItem('walletConnected');
  showToast('Wallet disconnected 🔌', false);
}

function shortenAddress(address) {
  return address.slice(0, 6) + '...' + address.slice(-4);
}

function fetchTweetsFromChain(address) {
  const tweetList = document.getElementById('tweetList');
  tweetList.innerHTML = ''; // Clear old tweets

  const tweets = [
    { user: address, content: "Hello from the blockchain!" },
    { user: address, content: "This is a decentralized tweet." }
  ];

  tweets.forEach(tweet => {
    const div = document.createElement('div');
    div.className = 'tweet';
    div.innerHTML = `<strong>${tweet.user}</strong><p>${tweet.content}</p>`;
    tweetList.appendChild(div);
  });
}

function showToast(message, isSuccess = true) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.backgroundColor = isSuccess ? '#28a745' : '#dc3545';
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}