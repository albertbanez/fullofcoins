const connectBtn = document.getElementById('connectBtn');
const walletAddressDiv = document.getElementById('walletAddress');
const walletModal = document.getElementById('walletModal');
const metamaskBtn = document.getElementById('metamaskBtn');
const closeModal = document.getElementById('closeModal');

let provider;
let signer;
let connectedAddress = null;

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

// Connect with MetaMask and switch to Sepolia
metamaskBtn.addEventListener('click', async () => {
  if (typeof window.ethereum === 'undefined') {
    alert('MetaMask not installed');
    return;
  }

  try {
    provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    signer = provider.getSigner();
    connectedAddress = await signer.getAddress();

    // Switch to Sepolia (chainId: 11155111)
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0xaa36a7' }],
    });

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
  connectBtn.textContent = shortenAddress(address) + ' (Logout)';
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
    { user: address, content: "Hello from Sepolia!" },
    { user: address, content: "This is a blockchain tweet." }
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