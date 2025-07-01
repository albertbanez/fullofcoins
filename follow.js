// follow.js (DEBUG VERSION)

document.addEventListener('DOMContentLoaded', () => {
    const tweetList = document.getElementById('tweetList')
    if (!tweetList) return

    tweetList.addEventListener('click', async e => {
        const followButton = e.target.closest('.follow-btn')

        // --- Step 1: Is the event firing on the right element? ---
        if (!followButton) {
            // If you click elsewhere on the tweet, this will be null. This is normal.
            return
        }

        console.log('--- DEBUGGING FOLLOW CLICK ---')
        console.log('1. Follow button was clicked!')

        e.preventDefault()

        // --- Step 2: Are we logged in? ---
        if (!window.signer) {
            console.log('2. FAILED: window.signer is not available. Aborting.')
            alert('Please connect your wallet to follow a user.')
            return
        }
        console.log('2. PASSED: Wallet is connected (window.signer exists).')

        const userToFollow = followButton.dataset.author
        const chainId = followButton.dataset.chainId
        const isFollowing = followButton.classList.contains('following')

        console.log('3. Data from button:', {
            userToFollow,
            chainId,
            isFollowing,
        })

        // --- Step 3: Can we find the chain configuration? ---
        const chainConfig = (window.chains || []).find(
            c => c.chainId == chainId
        )
        if (!chainConfig) {
            console.log(
                '4. FAILED: Could not find chain config for chainId:',
                chainId
            )
            alert('Cannot find contract for this chain.')
            return
        }
        console.log('4. PASSED: Found chain config:', chainConfig)

        // --- Step 4: Is the full ABI available? ---
        if (!window.fullTweetContractAbi) {
            console.log(
                '5. FAILED: window.fullTweetContractAbi is not defined. Aborting.'
            )
            alert('Critical error: Full contract ABI not found.')
            return
        }
        console.log('5. PASSED: ABI is available.')

        // If we get this far, the button should at least change state
        followButton.disabled = true
        followButton.textContent = isFollowing
            ? 'Unfollowing...'
            : 'Following...'
        console.log('6. UI updated optimistically. Preparing transaction...')

        try {
            const contract = new ethers.Contract(
                chainConfig.contractAddress,
                window.fullTweetContractAbi,
                window.signer
            )

            console.log('7. Sending transaction to contract...')
            const tx = isFollowing
                ? await contract.unfollow(userToFollow)
                : await contract.follow(userToFollow)

            console.log('8. Transaction sent, waiting for confirmation...')
            await tx.wait()

            console.log('9. SUCCESS: Transaction confirmed!')

            // On success, update the button state permanently
            if (isFollowing) {
                followButton.classList.remove('following')
                followButton.textContent = 'Follow'
            } else {
                followButton.classList.add('following')
                followButton.textContent = 'Following'
            }
        } catch (err) {
            console.log('10. FAILED: Transaction reverted or failed.', err)
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
