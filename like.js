// like.js

// This file handles the on-chain "like" and "unlike" interactions.

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
