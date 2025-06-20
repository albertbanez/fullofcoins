const connectBtn = document.getElementById('connectBtn');
const walletAddressDiv = document.getElementById('walletAddress');

async function connectWallet() {
  if (typeof window.ethereum !== 'undefined') {
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      const signer = provider.getSigner();
      const address = await signer.getAddress();
      walletAddressDiv.textContent = `Connected: ${address}`;
      console.log("Wallet connected:", address);

      // Fetch tweets after connection
      fetchTweetsFromChain(address);
    } catch (err) {
      console.error('User rejected wallet connection', err);
    }
  } else {
    alert('MetaMask is not installed');
  }
}

function fetchTweetsFromChain(address) {
  // Replace with smart contract call in your app
  const tweetList = document.getElementById('tweetList');
  const tweets = [
    { user: address, content: "Hello world from Web3!" },
    { user: address, content: "This is a tweet stored on blockchain." }
  ];

  tweets.forEach(tweet => {
    const div = document.createElement('div');
    div.className = 'tweet';
    div.innerHTML = `<strong>${tweet.user}</strong><p>${tweet.content}</p>`;
    tweetList.appendChild(div);
  });
}

connectBtn.addEventListener('click', connectWallet);