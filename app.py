from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, join_room, leave_room, emit
import os

from collections import defaultdict

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.config['SECRET_KEY'] = os.urandom(24)
socketio = SocketIO(app)

online_users = defaultdict(dict)
active_calls = {}  
busy_users = defaultdict(set)  
user_sid = {}  
message_history = defaultdict(list)  

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')

@socketio.on('join')
def on_join(data):
    username = data['username']
    room = data['room']
    avatar = data.get('avatar', '1')
    is_reconnect = data.get('isReconnect', False)

    join_room(room)

    # Only send join message if user is not already in the room
    if username not in online_users[room]:
        online_users[room][username] = {
            'username': username,
            'avatar': avatar
        }
        
        if not is_reconnect:
            emit('message', {
                'msg': f'{username} has joined the room.',
                'username': 'System',
                'timestamp': None
            }, room=room)
    
    # Update user's socket ID
    user_sid[username] = request.sid
    
    # Always update the users list
    emit('update_users', {
        'users': [{
            **user,
            'isBusy': username in busy_users[room]
        } for username, user in online_users[room].items()]
    }, room=room)
    
    # Send message history to the joining user
    for message in message_history[room]:
        emit('message', message, to=request.sid)

@socketio.on('leave')
def on_leave(data):
    username = data['username']
    room = data['room']
    leave_room(room)
    online_users[room].pop(username, None)
    
    emit('message', {
        'msg': f'{username} has left the room.',
        'username': 'System'
    }, room=room)
    
    emit('update_users', {
        'users': list(online_users[room].values())
    }, room=room)

@socketio.on('message')
def handle_message(data):
    room = data['room']
    emit('message', {
        'msg': data['msg'],
        'username': data['username']
    }, room=room)

@socketio.on('typing')
def handle_typing(data):
    room = data['room']
    username = data['username']
    emit('typing', {
        'username': username
    }, room=room)

@socketio.on('stop_typing')
def handle_stop_typing(data):
    room = data['room']
    username = data['username']
    emit('stop_typing', {
        'username': username
    }, room=room)

@socketio.on('call_user')
def handle_call_user(data):
    room = data['room']
    caller = data['caller']
    target = data['target']
    
    # Check if room exists
    if room not in online_users:
        emit('call_error', {
            'message': 'Invalid room'
        }, to=user_sid[caller])
        return
        
    # Check if caller is in busy_users from previous failed cleanup
    if caller in busy_users[room]:
        busy_users[room].discard(caller)  
    
    if target in busy_users[room]:
        busy_users[room].discard(target)  
    
    if not all([room, caller, target]):
        emit('call_error', {
            'message': 'Invalid call data'
        }, to=user_sid[caller])
        return
    
    if target not in online_users[room]:
        emit('call_error', {
            'message': 'User is offline'
        }, to=user_sid[caller])
        return
    
    if target in busy_users[room]:
        emit('call_busy', {
            'target': target
        }, to=user_sid[caller])
        return
        
    if caller in busy_users[room]:
        emit('call_error', {
            'message': 'You are already in a call'
        }, to=user_sid[caller])
        return
    
    # Add to active calls
    active_calls[room] = {
        'caller': caller,
        'target': target,
        'status': 'ringing'
    }
    
    # Mark users as busy
    busy_users[room].add(caller)
    busy_users[room].add(target)
    
    # Notify caller that call is ringing
    emit('call_ringing', {
        'target': target
    }, to=user_sid[caller])
    
    # Send incoming call to target only
    emit('incoming_call', {
        'caller': caller,
        'target': target
    }, to=user_sid[target])

@socketio.on('call_accepted')
def handle_call_accepted(data):
    room = data['room']
    target = data['target']
    caller = data['caller']
    
    if room in active_calls:
        active_calls[room]['status'] = 'connected'
        # Remove duplicate busy state setting since it's already set in call_user
        busy_users[room].add(target)  # Remove this
        busy_users[room].add(caller)  # Remove this
        
        # Notify both users
        emit('call_accepted', {
            'target': target
        }, to=user_sid[caller])
        emit('call_connected', {
            'caller': caller
        }, to=user_sid[target])
        
        # Update other users about busy status
        emit('update_users', {
            'users': [{
                **user,
                'isBusy': username in busy_users[room]
            } for username, user in online_users[room].items()]
        }, room=room)

@socketio.on('call_declined')
def handle_call_declined(data):
    room = data['room']
    if room in active_calls:
        caller = active_calls[room]['caller']
        target = active_calls[room]['target']
        
        # Clean up busy states
        busy_users[room].discard(caller)
        busy_users[room].discard(target)
        
        # Remove from active calls
        del active_calls[room]
        
        # Notify about decline
        emit('call_declined', {}, to=user_sid[caller])
        
        # Update other users about status change
        emit('update_users', {
            'users': [{
                **user,
                'isBusy': username in busy_users[room]
            } for username, user in online_users[room].items()]
        }, room=room)

@socketio.on('call_ended')
def handle_call_ended(data):
    room = data['room']
    username = data['username']

    if room in active_calls:
        caller = active_calls[room]['caller']
        target = active_calls[room]['target']
        
        # Clean up busy states
        busy_users[room].discard(caller)
        busy_users[room].discard(target)
        
        # Remove from active calls
        del active_calls[room]
        
        # Emit call_ended to both users
        emit('call_ended', {}, to=user_sid[caller])
        emit('call_ended', {}, to=user_sid[target])
        
        # Emit single system message to the room
        emit('message', {
            'msg': 'Call ended.',
            'username': 'System',
            'timestamp': None  # Client will add timestamp
        }, room=room)
        
        # Update user states for everyone in the room
        emit('update_users', {
            'users': [{
                **user,
                'isBusy': username in busy_users[room]
            } for username, user in online_users[room].items()]
        }, room=room)

@socketio.on('disconnect')
def handle_disconnect():
    for room in busy_users:
        for username, sid in user_sid.items():
            if sid == request.sid:
                busy_users[room].discard(username)
                if room in active_calls:
                    if username in [active_calls[room]['caller'], active_calls[room]['target']]:
                        # Don't emit call_ended here, let the client handle it
                        del active_calls[room]
                break

@socketio.on('ice_candidate')
def handle_ice_candidate(data):
    room = data['room']
    target = data.get('target')
    
    if room not in active_calls:
        return
        
    # Send ICE candidate only to target user
    emit('ice_candidate', {
        'candidate': data['candidate']
    }, to=user_sid[target])

@socketio.on('offer')
def handle_offer(data):
    room = data['room']
    target = data.get('target')
    
    if room not in active_calls:
        return
        
    # Send offer only to target user
    emit('offer', {
        'offer': data['offer']
    }, to=user_sid[target])

@socketio.on('answer')
def handle_answer(data):
    room = data['room']
    target = data.get('target')
    
    if room not in active_calls:
        return
        
    # Send answer only to target user
    emit('answer', {
        'answer': data['answer']
    }, to=user_sid[target])

@socketio.on('decline_call')
def handle_decline_call(data):
    room = data['room']
    if room in active_calls:
        caller = active_calls[room]['caller']
        target = active_calls[room]['target']
        
        # Clean up busy states
        busy_users[room].discard(caller)
        busy_users[room].discard(target)
        
        del active_calls[room]
        
        # Notify about decline
        emit('call_declined', {}, to=user_sid[caller])
        
        # Update all users about status
        emit('update_users', {
            'users': [{
                **user,
                'isBusy': username in busy_users[room]
            } for username, user in online_users[room].items()]
        }, room=room)

def cleanup_call_state(room, caller, target):
    """Helper function to clean up call states"""
    if room in active_calls:
        del active_calls[room]
    
    if room in busy_users:
        busy_users[room].discard(caller)
        busy_users[room].discard(target)
    
    emit('update_users', {
        'users': [{
            **user,
            'isBusy': username in busy_users[room]
        } for username, user in online_users[room].items()]
    }, room=room)

if __name__ == '__main__':
    try:
        socketio.run(app,host='localhost',port=5000,debug=True,use_reloader=False)
    except Exception as e:
        print(f"Error starting server: {e}")
