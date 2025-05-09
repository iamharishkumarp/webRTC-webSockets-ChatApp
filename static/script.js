document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const loginForm = document.getElementById('login-form');
    const messageForm = document.getElementById('message-form');
    const leaveBtn = document.getElementById('leave-btn');
    const loginContainer = document.getElementById('login-container');
    const chatContainer = document.getElementById('chat-container');
    const messagesDiv = document.getElementById('messages');
    const roomNameSpan = document.getElementById('room-name');
    const emojiButton = document.getElementById('emoji-button');
    const emojiPicker = document.getElementById('emoji-picker');
    const messageInput = document.getElementById('message');
    const usersList = document.getElementById('users-list');
    const typingIndicator = document.getElementById('typing-indicator');
    let typingTimer;
    let selectedAvatar = localStorage.getItem('avatar') || '';
    
    // Storage for messages
    const MAX_MESSAGES = 50;
    let currentUser = localStorage.getItem('username') || '';
    let currentRoom = localStorage.getItem('room') || '';
    let chatMessages = JSON.parse(localStorage.getItem(`messages_${currentRoom}`)) || [];

    // WebRTC variables
    let peerConnection = null;
    let localStream = null;
    let remoteStream = null;
    let isInCall = false;
    let currentCallUser = null;
    let isCallPending = false;
    const servers = {
        iceServers: [
            {
                urls: [
                    'stun:stun1.l.google.com:19302',
                    'stun:stun2.l.google.com:19302',
                    'stun:stun3.l.google.com:19302',
                    'stun:stun4.l.google.com:19302'
                ]
            }
        ]
    };

    // Add these variables with other WebRTC variables
    let callStartTime = null;
    let durationTimer = null;

    // Add this function after WebRTC variables declaration
    async function checkMediaPermissions() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: true, 
                audio: true 
            });
            // Stop the test stream
            stream.getTracks().forEach(track => track.stop());
            return true;
        } catch (err) {
            console.error('Media permission error:', err);
            return false;
        }
    }

    function formatDuration(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    function updateCallDuration() {
        if (!callStartTime) return;
        const duration = Math.floor((Date.now() - callStartTime) / 1000);
        console.log('Call duration:', duration); // Debug log
        document.getElementById('call-duration').textContent = formatDuration(duration);
    }

    // Initially hide chat container
    chatContainer.classList.add('hidden');
    loginContainer.classList.remove('hidden');

    // Clear any previous session if exists
    if (!currentUser || !currentRoom) {
        localStorage.removeItem('username');
        localStorage.removeItem('room');
        localStorage.removeItem(`messages_${currentRoom}`);
        chatMessages = [];
    }
    
    // Add this function to save messages
    function saveMessageToHistory(message) {
        const messageHistory = JSON.parse(localStorage.getItem(`messages_${currentRoom}`) || '[]');
        messageHistory.push(message);
        localStorage.setItem(`messages_${currentRoom}`, JSON.stringify(messageHistory));
    }

    function displayMessage(data) {
        // Add check for duplicate system messages
        if (data.username === 'System' && data.msg.includes('has joined the room')) {
            // Check if this message already exists
            const existingMessages = Array.from(messagesDiv.querySelectorAll('.message.system'))
                .map(el => el.textContent);
            if (existingMessages.includes(data.msg)) {
                return; // Skip if message already exists
            }
        }

        const messageContainer = document.createElement('div');
        messageContainer.classList.add('message-container');
        
        if (data.username === 'System') {
            const messageDiv = document.createElement('div');
            messageDiv.classList.add('message', 'system');
            messageDiv.textContent = data.msg;
            messageContainer.appendChild(messageDiv);

            // Only store join messages if they're new
            if (data.msg.includes('has joined the room') && !data.isStoredMessage) {
                // Check if message already exists in storage
                const storedMessages = JSON.parse(localStorage.getItem(`messages_${currentRoom}`) || '[]');
                const isDuplicate = storedMessages.some(m => 
                    m.msg === data.msg && m.username === 'System'
                );
                
                if (!isDuplicate) {
                    chatMessages.push({
                        msg: data.msg,
                        username: 'System',
                        isSystem: true,
                        timestamp: new Date().toLocaleTimeString()
                    });
                    localStorage.setItem(`messages_${currentRoom}`, JSON.stringify(chatMessages));
                }
            }
        } else {
            if (data.username !== currentUser) {
                const usernameDiv = document.createElement('div');
                usernameDiv.classList.add('message-username');
                usernameDiv.textContent = data.username;
                messageContainer.appendChild(usernameDiv);
            }
            
            const messageDiv = document.createElement('div');
            messageDiv.classList.add('message');
            messageDiv.classList.add(data.username === currentUser ? 'user' : 'other');
            messageDiv.textContent = data.msg;
            messageContainer.appendChild(messageDiv);

            // Add timestamp element
            const timestampDiv = document.createElement('div');
            timestampDiv.classList.add('message-timestamp');
            timestampDiv.textContent = data.timestamp || new Date().toLocaleTimeString();
            messageDiv.appendChild(timestampDiv);

            // Store non-system messages
            if (!data.isStoredMessage) {
                chatMessages.push({
                    msg: data.msg,
                    username: data.username,
                    timestamp: new Date().toLocaleTimeString()
                });
                
                if (chatMessages.length > MAX_MESSAGES) {
                    chatMessages = chatMessages.slice(-MAX_MESSAGES);
                }
                localStorage.setItem(`messages_${currentRoom}`, JSON.stringify(chatMessages));
            }
        }
        
        messagesDiv.appendChild(messageContainer);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        // Save message to history
        saveMessageToHistory({
            msg: data.msg,
            username: data.username,
            timestamp: data.timestamp || new Date().toLocaleTimeString()
        });
    }

    // Load saved messages
    function loadSavedMessages() {
        if (currentRoom) {
            messagesDiv.innerHTML = '';
            
            const savedMessages = JSON.parse(localStorage.getItem(`messages_${currentRoom}`) || '[]');
            const uniqueMessages = savedMessages.filter((msg, index, self) =>
                index === self.findIndex((m) => (
                    m.msg === msg.msg && 
                    m.username === msg.username &&
                    m.timestamp === msg.timestamp
                ))
            );
            
            uniqueMessages.forEach(msgData => {
                msgData.isStoredMessage = true;
                displayMessage(msgData);
            });
        }
    }

    // Add this function to load messages on room join
    function loadMessageHistory() {
        const messageHistory = JSON.parse(localStorage.getItem(`messages_${currentRoom}`) || '[]');
        messageHistory.forEach(msg => {
            displayMessage(msg);
        });
    }

    // Change the login check section
    if (currentUser && currentRoom) {
        const savedAvatar = localStorage.getItem('avatar');
        selectedAvatar = savedAvatar;
        
        loginContainer.classList.add('hidden');
        chatContainer.classList.remove('hidden');
        roomNameSpan.textContent = currentRoom;
        
        // Always pass isReconnect as true when refreshing/reconnecting
        socket.emit('join', { 
            username: currentUser, 
            room: currentRoom,
            avatar: savedAvatar,
            isReconnect: true
        });
        loadSavedMessages();
    }

    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!selectedAvatar) {
            alert('Please select an avatar');
            return;
        }
        const username = document.getElementById('username').value;
        const room = document.getElementById('room').value;
        
        currentUser = username;
        currentRoom = room;
        
        localStorage.setItem('username', username);
        localStorage.setItem('room', room);
        localStorage.setItem('avatar', selectedAvatar);
        
        // Pass isReconnect as false for new logins
        socket.emit('join', { 
            username, 
            room, 
            avatar: selectedAvatar,
            isReconnect: false 
        });
        
        loginContainer.classList.add('hidden');
        chatContainer.classList.remove('hidden');
        roomNameSpan.textContent = room;
    });

    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = messageInput.value;
        
        if (message.trim()) {
            socket.emit('message', {
                msg: message,
                username: currentUser,
                room: currentRoom
            });
            messageInput.value = '';
        }
    });

    leaveBtn.addEventListener('click', () => {
        socket.emit('leave', {
            username: currentUser,
            room: currentRoom
        });
        localStorage.removeItem('username');
        
        localStorage.removeItem('room');
        localStorage.removeItem(`messages_${currentRoom}`);
        chatMessages = [];
        
        chatContainer.classList.add('hidden');
        loginContainer.classList.remove('hidden');
        messagesDiv.innerHTML = '';
        document.getElementById('username').value = '';
        document.getElementById('room').value = '';
        
        currentUser = '';
        currentRoom = '';
    });

    socket.on('message', (data) => {
        displayMessage(data);
    });

    // Update the call button in users list rendering
    socket.on('update_users', (data) => {
        usersList.innerHTML = data.users.map(user => {
            const avatarSeed = user.avatar || 'happy';
            return `
                <li>
                    <div class="user-info">
                        <div class="user-avatar">
                            <img src="https://api.dicebear.com/7.x/fun-emoji/svg?seed=${avatarSeed}&backgroundColor=b6e3f4" 
                                 alt="avatar">
                            <span class="online-status"></span>
                        </div>
                        ${user.username === currentUser ? 
                            `${user.username} (You)` : 
                            `<div class="user-actions">
                                ${user.username}
                                <button class="call-btn" data-user="${user.username}"
                                        ${user.isBusy ? 'disabled' : ''}>
                                    ${user.isBusy ? 'In Call' : 'Call'}
                                </button>
                            </div>`
                        }
                    </div>
                </li>
            `;
        }).join('');
    });

    // Emoji picker functionality
    emojiButton.addEventListener('click', () => {
        emojiPicker.classList.toggle('hidden');
    });

    emojiPicker.addEventListener('emoji-click', event => {
        const cursorPos = messageInput.selectionStart;
        const text = messageInput.value;
        const newText = text.slice(0, cursorPos) + event.detail.unicode + text.slice(cursorPos);
        messageInput.value = newText;
        messageInput.focus();
        messageInput.setSelectionRange(cursorPos + event.detail.unicode.length, cursorPos + event.detail.unicode.length);
        emojiPicker.classList.add('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!emojiButton.contains(e.target) && !emojiPicker.contains(e.target)) {
            emojiPicker.classList.add('hidden');
        }
    });

    // Add typing event listeners
    messageInput.addEventListener('keyup', () => {
        clearTimeout(typingTimer);
        socket.emit('typing', { 
            username: currentUser, 
            room: currentRoom 
        });
        
        typingTimer = setTimeout(() => {
            socket.emit('stop_typing', { 
                username: currentUser, 
                room: currentRoom 
            });
        }, 1000);
    });

    // Handle typing events
    socket.on('typing', (data) => {
        if (data.username !== currentUser) {
            typingIndicator.textContent = `${data.username} is typing...`;
            typingIndicator.classList.remove('hidden');
        }
    });

    socket.on('stop_typing', (data) => {
        if (data.username !== currentUser) {
            typingIndicator.classList.add('hidden');
        }
    });

    document.querySelectorAll('.avatar-option').forEach(avatar => {
        const seed = avatar.getAttribute('data-seed'); // Use getAttribute to fetch data-seed
        
        // Highlight the selected avatar on page load
        if (seed === selectedAvatar) {
            avatar.classList.add('selected');
        }
    
        avatar.addEventListener('click', () => {
            // Remove 'selected' class from all avatars
            document.querySelectorAll('.avatar-option').forEach(a => a.classList.remove('selected'));
            
            // Add 'selected' class to the clicked avatar
            avatar.classList.add('selected');
            
            // Update the selected avatar
            selectedAvatar = seed;
            localStorage.setItem('avatar', selectedAvatar); // Save to localStorage
            document.getElementById('selected-avatar').value = selectedAvatar; // Update hidden input
        });
    });

    // WebRTC functions
    async function startCall(targetUser) {
        if (isInCall || isCallPending) {
            alert('You are already in a call or have a pending call');
            return;
        }

        try {
            isCallPending = true;
            currentCallUser = targetUser;

            // Initialize WebRTC
            await setupPeerConnection();

            // Notify the server about the call
            socket.emit('call_user', {
                caller: currentUser,
                target: targetUser,
                room: currentRoom
            });

            // Update UI
            document.querySelector(`[data-user="${targetUser}"]`).textContent = 'Calling...';
            document.getElementById('video-container').classList.remove('hidden');
            document.querySelector('.video-controls').classList.remove('hidden');
        } catch (err) {
            console.error('Error starting call:', err);
            endCall();
        }
    }

    // Add event listeners for video controls
    document.getElementById('mute-btn').addEventListener('click', () => {
        const audioTrack = localStream.getAudioTracks()[0];
        audioTrack.enabled = !audioTrack.enabled;
        document.getElementById('mute-btn').textContent = 
            audioTrack.enabled ? 'Mute' : 'Unmute';
    });

    document.getElementById('camera-btn').addEventListener('click', () => {
        const videoTrack = localStream.getVideoTracks()[0];
        videoTrack.enabled = !videoTrack.enabled;
        document.getElementById('camera-btn').textContent = 
            videoTrack.enabled ? 'Camera Off' : 'Camera On';
    });

    document.getElementById('end-call-btn').addEventListener('click', () => {
        endCall();
    });

    // Add Socket.IO event handlers for video call
    socket.on('incoming_call', data => {
        if (isInCall) {
            socket.emit('call_busy', { room: currentRoom, caller: data.caller });
            return;
        }
        currentCallUser = data.caller;
        document.getElementById('caller-name').textContent = data.caller;
        document.getElementById('call-modal').classList.remove('hidden');
    });

    socket.on('ice_candidate', async data => {
        if (peerConnection) {
            await peerConnection.addIceCandidate(data.candidate);
        }
    });

    socket.on('offer', async data => {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            socket.emit('answer', {
                answer: answer,
                room: currentRoom,
                target: currentCallUser
            });
        } catch (err) {
            console.error('Error handling offer:', err);
            endCall();
        }
    });

    socket.on('answer', async data => {
        if (peerConnection) {
            await peerConnection.setRemoteDescription(data.answer);
        }
    });

    socket.on('call_accepted', async (data) => {
        try {
            isCallPending = false;
            isInCall = true;

            // Start the timer when the receiver accepts the call
            callStartTime = Date.now();
            durationTimer = setInterval(updateCallDuration, 1000);

            // Sender creates and sends the offer
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            socket.emit('offer', {
                offer: offer,
                room: currentRoom,
                target: currentCallUser
            });
        } catch (err) {
            console.error('Error creating offer:', err);
            endCall();
        }
    });

    socket.on('call_declined', () => {
        alert('Call was declined');
        endCall();
    });

    socket.on('call_busy', () => {
        alert('User is busy');
        endCall();
    });

    socket.on('call_error', data => {
        alert(data.message);
        endCall();
    });

    let callEndedDisplayed = false; // Add a flag to prevent duplicate messages

    socket.off('call_ended'); // Remove existing listeners
    socket.on('call_ended', () => {
        if (!callEndedDisplayed) {
            callEndedDisplayed = true;
            
            // Force cleanup of call state
            isInCall = false;
            isCallPending = false;
            
            if (localStream) {
                localStream.getTracks().forEach((track) => track.stop());
                localStream = null;
            }

            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }

            // Clear video elements
            document.getElementById('local-video').srcObject = null;
            document.getElementById('remote-video').srcObject = null;

            // Hide video elements
            document.getElementById('video-container').classList.add('hidden');
            document.querySelector('.video-controls').classList.add('hidden');
            document.getElementById('call-modal').classList.add('hidden');

            // Reset button states
            document.querySelectorAll('.call-btn').forEach((btn) => {
                btn.disabled = false;
                btn.textContent = 'Call';
            });

            // Clear the duration timer
            clearInterval(durationTimer);
            callStartTime = null;
            document.getElementById('call-duration').textContent = '00:00';

            // Reset the flag after a short delay
            setTimeout(() => {
                callEndedDisplayed = false;
            }, 1000);
        }
    });

    // Reset the flag when a new call starts
    function resetCallState() {
        callEndedDisplayed = false;
    }

    socket.on('call_ringing', data => {
        document.getElementById('calling-status').textContent = `Calling ${data.target}...`;
    });

    socket.on('call_connected', data => {
        isCallPending = false;
        isInCall = true;
        setupVideoCall();
    });

    // Add call button click handler
    document.addEventListener('click', e => {
        if (e.target.classList.contains('call-btn')) {
            const targetUser = e.target.dataset.user;
            startCall(targetUser);
        }
    });

    function endCall() {
        isInCall = false;
        isCallPending = false;

        if (localStream) {
            localStream.getTracks().forEach((track) => track.stop());
            localStream = null;
        }

        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }

        // Clear video elements
        document.getElementById('local-video').srcObject = null;
        document.getElementById('remote-video').srcObject = null;

        // Hide video elements
        document.getElementById('video-container').classList.add('hidden');
        document.querySelector('.video-controls').classList.add('hidden');
        document.getElementById('call-modal').classList.add('hidden');

        // Reset button states
        document.querySelectorAll('.call-btn').forEach((btn) => {
            btn.disabled = false;
            btn.textContent = 'Call';
        });

        // Reset user states
        currentCallUser = null;

        // Clear the duration timer
        clearInterval(durationTimer);
        callStartTime = null;
        document.getElementById('call-duration').textContent = '00:00';

        // Only emit the event, don't display message here
        socket.emit('call_ended', {
            room: currentRoom,
            username: currentUser
        });
    }

    // Add these event listeners
    document.getElementById('accept-call').addEventListener('click', async () => {
        try {
            isInCall = true;

            // Start the timer when the receiver accepts the call
            callStartTime = Date.now();
            durationTimer = setInterval(updateCallDuration, 1000);

            document.getElementById('call-modal').classList.add('hidden');

            // Initialize WebRTC
            await setupPeerConnection();

            // Notify the server that the call is accepted
            socket.emit('call_accepted', {
                room: currentRoom,
                target: currentCallUser,
                caller: currentCallUser
            });

            // Show video container
            document.getElementById('video-container').classList.remove('hidden');
            document.querySelector('.video-controls').classList.remove('hidden');
        } catch (err) {
            console.error('Error accepting call:', err);
            endCall();
        }
    });

    document.getElementById('decline-call').addEventListener('click', () => {
        const modal = document.getElementById('call-modal');
        modal.classList.add('hidden');
        socket.emit('decline_call', { room: currentRoom });
    });

    // Add cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (isInCall || isCallPending) {
            endCall();
        }
    });

    // Add this helper function
    async function setupPeerConnection() {
        peerConnection = new RTCPeerConnection(servers);
        
        // Set up local media stream
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        document.getElementById('local-video').srcObject = localStream;
        
        // Add tracks to peer connection
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // Handle incoming tracks
        peerConnection.ontrack = ({ streams: [stream] }) => {
            document.getElementById('remote-video').srcObject = stream;
        };
        
        // Handle ICE candidates
        peerConnection.onicecandidate = event => {
            if (event.candidate) {
                socket.emit('ice_candidate', {
                    candidate: event.candidate,
                    room: currentRoom,
                    target: currentCallUser
                });
            }
        };

        // Add connection state change logging
        peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', peerConnection.connectionState);
            if (peerConnection.connectionState === 'disconnected' || 
                peerConnection.connectionState === 'failed' ||
                peerConnection.connectionState === 'closed') {
                endCall();
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE Connection state:', peerConnection.iceConnectionState);
            if (peerConnection.iceConnectionState === 'disconnected' ||
                peerConnection.iceConnectionState === 'failed' ||
                peerConnection.iceConnectionState === 'closed') {
                endCall();
            }
        };

        return peerConnection;
    }

    socket.on('connect', () => {
        console.log('WebSocket connected');
    });

    socket.on('disconnect', () => {
        console.log('WebSocket disconnected');
    });

    socket.on('connect_error', (err) => {
        console.error('WebSocket connection error:', err);
    });

    // Call loadMessageHistory when joining a room
    socket.on('join', (data) => {
        // ...existing join code...
        loadMessageHistory();
    });
});