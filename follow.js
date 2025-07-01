// follow.js

// This file handles the on-chain "follow" and "unfollow" interactions.

document.addEventListener('DOMContentLoaded', () => {
    // We'll use event delegation on the main tweet list
    const tweetList = document.getElementById('tweetList')
    if (!tweetList) return

    tweetList.addEventListener('click', async e => {
        const followButton = e.target.closest('.follow-btn')
        if (!followButton) return

        e.preventDefault() // Prevent any default link behavior

        if (!window.signer) {
            alert('Please connect your wallet to follow a user.')
            return
        }

        const userToFollow = followButton.dataset.author
        const chainId = followButton.dataset.chainId
        const isFollowing = followButton.classList.contains('following')

        // Find the contract config for this chain
        const chainConfig = (window.chains || []).find(
            c => c.chainId == chainId
        )
        if (!chainConfig) {
            alert('Cannot find contract for this chain.')
            return
        }

        // Optimistic UI update
        followButton.disabled = true
        followButton.textContent = isFollowing
            ? 'Unfollowing...'
            : 'Following...'

        try {
            // NOTE: We need the full ABI to call functions.
            // We assume it's available on `window.fullTweetContractAbi`.
            if (!window.fullTweetContractAbi) {
                throw new Error('Full contract ABI not found.')
            }

            const contract = new ethers.Contract(
                chainConfig.contractAddress,
                window.fullTweetContractAbi,
                window.signer
            )

            const tx = isFollowing
                ? await contract.unfollow(userToFollow)
                : await contract.follow(userToFollow)
            await tx.wait()

            console.log(
                `User ${isFollowing ? 'unfollowed' : 'followed'} successfully!`
            )

            // On success, update the button state permanently
            if (isFollowing) {
                followButton.classList.remove('following')
                followButton.textContent = 'Follow'
            } else {
                followButton.classList.add('following')
                followButton.textContent = 'Following'
            }
        } catch (err) {
            console.error('Follow/Unfollow transaction failed:', err)
            alert(`Action failed: ${err.reason || err.message}`)

            // Revert the UI on failure
            if (isFollowing) {
                followButton.classList.add('following')
                followButton.textContent = 'Following'
            } else {
                followButton.classList.remove('following')
                followButton.textContent = 'Follow'
            }
        } finally {
            followButton.disabled = false
        }
    })
})
