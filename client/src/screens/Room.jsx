import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSocket } from '../context/SocketProvider';
import peer from '../service/peer';

export default function Room() {
  const socket = useSocket();
  const [remoteSocketId, setRemoteSocketId] = useState(null);
  const [myStream, setMyStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionState, setConnectionState] = useState('new');
  const [iceConnectionState, setIceConnectionState] = useState('new');

  const handleUserJoined = useCallback(({ email, id }) => {
    console.log(`Email ${email} joined!`);
    setRemoteSocketId(id);
  }, []);

  // Send ICE candidates when gathered
useEffect(() => {
  const peerConnection = peer.peer;

  const handleIceCandidate = (event) => {
    if (event.candidate && remoteSocketId) {
      console.log('Sending ICE candidate:', {
        type: event.candidate.type,
        protocol: event.candidate.protocol,
        address: event.candidate.address || 'hidden',
        port: event.candidate.port
      });
      socket.emit('ice-candidate', { 
        to: remoteSocketId, 
        candidate: event.candidate 
      });
    } else if (!event.candidate) {
      console.log('ICE gathering complete');
      // Send a null candidate to signal completion
      socket.emit('ice-candidate', { 
        to: remoteSocketId, 
        candidate: null 
      });
    }
  };

  peerConnection.addEventListener('icecandidate', handleIceCandidate);
  return () => peerConnection.removeEventListener('icecandidate', handleIceCandidate);
}, [socket, remoteSocketId]);

  // Receive ICE candidates from remote peer
  useEffect(() => {
    const handleNewIceCandidate = async ({ candidate }) => {
      if (candidate) {
        try {
          console.log('Receiving ICE candidate:', candidate);
          await peer.addIceCandidate(candidate);
        } catch (err) {
          console.error("Error adding ICE candidate:", err);
        }
      }
    };

    socket.on('ice-candidate', handleNewIceCandidate);
    return () => socket.off('ice-candidate', handleNewIceCandidate);
  }, [socket]);

  const sendStream = useCallback((stream) => {
    const pc = peer.peer;
    
    // Remove existing tracks first to avoid duplicates
    const senders = pc.getSenders();
    senders.forEach(sender => {
      if (sender.track) {
        console.log('Removing existing track:', sender.track.kind);
        pc.removeTrack(sender);
      }
    });
    
    // Add new tracks
    stream.getTracks().forEach(track => {
      console.log('Adding track:', track.kind, track.id, 'enabled:', track.enabled, 'readyState:', track.readyState);
      pc.addTrack(track, stream);
    });

    console.log('Stream sent, total senders:', pc.getSenders().length);
  }, []);

  const handleCallUser = useCallback(async () => {
  try {
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      }
    };
    
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    setMyStream(stream);
    sendStream(stream);
    
    // Add delay to ensure tracks are properly added
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const offer = await peer.getOffer();
    socket.emit('user:call', { to: remoteSocketId, offer: offer });
  } catch (err) {
    console.error('Error accessing camera: ', err);
    // Try with simpler constraints if failed
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
      });
      setMyStream(stream);
      sendStream(stream);
      const offer = await peer.getOffer();
      socket.emit('user:call', { to: remoteSocketId, offer: offer });
    } catch (fallbackErr) {
      console.error('Fallback media access failed:', fallbackErr);
    }
  }
}, [remoteSocketId, socket, sendStream]);

  const handleIncommingCall = useCallback(
    async (data) => {
      const { from, offer } = data;
      console.log(`Incoming call from ${from}`);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });
        setMyStream(stream);

        // Add tracks BEFORE creating answer
        sendStream(stream);

        // Wait a bit for tracks to be properly added
        await new Promise(resolve => setTimeout(resolve, 100));

        const ans = await peer.getAnswer(offer);
        socket.emit('call:accepted', { to: from, ans: ans });
        console.log('Call answered');
      } catch (err) {
        console.error('Error accessing camera: ', err);
      }
    },
    [socket, sendStream]
  );

const handleCallAccepted = useCallback(
  async (data) => {
    const { from, ans } = data;
    console.log('Setting remote answer...');
    console.log('Current signaling state before set:', peer.peer.signalingState);
    console.log('Current ICE state:', peer.peer.iceConnectionState);
    
    try {
      await peer.setRemoteDescription(ans);
      console.log('Remote description set successfully');
      console.log('New signaling state:', peer.peer.signalingState);
    } catch (err) {
      console.error('Failed to set remote description:', err);
      // Try recreating the connection
      peer.recreate();
      // Retry the call
      if (myStream) {
        sendStream(myStream);
        const newOffer = await peer.getOffer();
        socket.emit('user:call', { to: remoteSocketId, offer: newOffer });
      }
    }
  },
  [myStream, remoteSocketId, socket, sendStream]
);

  // Handle incoming tracks (FIXED VERSION)
  useEffect(() => {
    const peerConnection = peer.peer;

    const handleTrack = (ev) => {
      console.log('Track event received:', ev);
      console.log('Event streams:', ev.streams?.length || 0);
      console.log('Event track:', ev.track?.kind, ev.track?.id);
      
      if (ev.streams && ev.streams.length > 0) {
        const stream = ev.streams[0];
        console.log("Received remote stream:", stream.id);
        console.log("Stream tracks:", stream.getTracks().map(t => `${t.kind}: ${t.id} (${t.readyState})`));
        
        // Verify tracks are live
        const liveTracks = stream.getTracks().filter(track => track.readyState === 'live');
        console.log("Live tracks:", liveTracks.length);
        
        if (liveTracks.length > 0) {
          setRemoteStream(prevStream => {
            if (!prevStream || prevStream.id !== stream.id) {
              console.log('Setting new remote stream with', liveTracks.length, 'live tracks');
              return stream;
            }
            return prevStream;
          });
        } else {
          console.warn('No live tracks in received stream');
        }
      } else {
        console.warn('No streams in track event');
      }
    };

    peerConnection.addEventListener('track', handleTrack);
    return () => peerConnection.removeEventListener('track', handleTrack);
  }, []);

  const handleNegoNeedIn = useCallback(
    async ({ from, offer }) => {
      console.log('Negotiation needed incoming');
      const ans = await peer.getAnswer(offer);
      socket.emit('peer:nego:done', { to: from, ans: ans });
    },
    [socket]
  );

  const handleNegoFinal = useCallback(async ({ from, ans }) => {
    console.log('Final negotiation step');
    await peer.setRemoteDescription(ans); // Fixed: should be setRemoteDescription
  }, []);

  const handleNegoNeeded = useCallback(async () => {
    if (!myStream || !remoteSocketId) return;

    try {
      console.log("Negotiation needed - creating new offer");
      const offer = await peer.getOffer();
      socket.emit('peer:nego:needed', { 
        to: remoteSocketId, 
        offer: offer 
      });
    } catch (err) {
      console.error("Negotiation error:", err);
    }
  }, [remoteSocketId, socket, myStream]);

  // Handle renegotiation
  useEffect(() => {
    const pc = peer.peer;
    pc.addEventListener('negotiationneeded', handleNegoNeeded);
    return () => pc.removeEventListener('negotiationneeded', handleNegoNeeded);
  }, [handleNegoNeeded]);

  // Socket event listeners
  useEffect(() => {
    socket.on('user:joined', handleUserJoined);
    socket.on('incomming:call', handleIncommingCall);
    socket.on('call:accepted', handleCallAccepted);
    socket.on('peer:nego:needed', handleNegoNeedIn);
    socket.on('peer:nego:final', handleNegoFinal);
    
    return () => {
      socket.off('user:joined', handleUserJoined);
      socket.off('incomming:call', handleIncommingCall);
      socket.off('call:accepted', handleCallAccepted);
      socket.off('peer:nego:needed', handleNegoNeedIn);
      socket.off('peer:nego:final', handleNegoFinal);
    };
  }, [
    socket,
    handleUserJoined,
    handleIncommingCall,
    handleCallAccepted,
    handleNegoNeedIn,
    handleNegoFinal,
  ]);

// network monitoring
useEffect(() => {
  const checkNetwork = async () => {
    try {
      const stats = await peer.peer.getStats();
      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          console.log('Active candidate:', {
            localCandidate: report.localCandidateId,
            remoteCandidate: report.remoteCandidateId,
            transport: report.transportId,
            bytesSent: report.bytesSent,
            bytesReceived: report.bytesReceived
          });
        }
      });
    } catch (err) {
      console.error('Error checking network stats:', err);
    }
  };

  const interval = setInterval(checkNetwork, 5000);
  return () => clearInterval(interval);
}, []);

  // Connection state monitoring
  useEffect(() => {
    const pc = peer.peer;
    
    const handleIceConnectionChange = () => {
      const state = pc.iceConnectionState;
      console.log('ICE connection state:', state);
      setIceConnectionState(state);
      
      // If connection fails, try to restart ICE
      if (state === 'failed') {
        console.log('ICE connection failed, attempting restart...');
        pc.restartIce();
      }
    };
    
    const handleConnectionStateChange = () => {
      const state = pc.connectionState;
      console.log('Connection state:', state);
      setConnectionState(state);
    };

    const handleIceGatheringStateChange = () => {
      console.log('ICE gathering state:', pc.iceGatheringState);
    };

    pc.addEventListener('iceconnectionstatechange', handleIceConnectionChange);
    pc.addEventListener('connectionstatechange', handleConnectionStateChange);
    pc.addEventListener('icegatheringstatechange', handleIceGatheringStateChange);
    
    return () => {
      pc.removeEventListener('iceconnectionstatechange', handleIceConnectionChange);
      pc.removeEventListener('connectionstatechange', handleConnectionStateChange);
      pc.removeEventListener('icegatheringstatechange', handleIceGatheringStateChange);
    };
  }, []);

  // Improved VideoPlayer component with better remote video handling
  const VideoPlayer = React.memo(({ stream, isLocal, title }) => {
    const videoRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
      const videoElement = videoRef.current;
      if (!videoElement || !stream) return;

      console.log(`Setting up ${title} video with stream:`, stream.id);
      console.log(`${title} stream tracks:`, stream.getTracks().map(t => `${t.kind}: ${t.readyState} (enabled: ${t.enabled})`));

      // Clear any previous stream
      videoElement.srcObject = null;
      setIsPlaying(false);
      setHasError(false);

      // Small delay to ensure clean state
      const timeoutId = setTimeout(() => {
        videoElement.srcObject = stream;
        
        // For remote videos, ensure they're not muted initially
        if (!isLocal) {
          videoElement.muted = false;
          // Force autoplay for remote video
          videoElement.autoplay = true;
        }
      }, 100);

      const handleLoadStart = () => {
        console.log(`${title} video load start`);
      };

      const handleLoadedMetadata = () => {
        console.log(`${title} video metadata loaded`);
        console.log(`${title} video dimensions:`, videoElement.videoWidth, 'x', videoElement.videoHeight);
        
        // Attempt to play immediately after metadata loads
        const playPromise = videoElement.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              console.log(`${title} video playing successfully`);
              setIsPlaying(true);
            })
            .catch(err => {
              console.error(`${title} video play error:`, err);
              if (!isLocal && err.name === 'NotAllowedError') {
                // Try with muted for remote video
                videoElement.muted = true;
                videoElement.play()
                  .then(() => {
                    console.log(`${title} video playing muted`);
                    setIsPlaying(true);
                  })
                  .catch(e => console.error(`${title} muted play failed:`, e));
              }
            });
        }
      };

      const handleCanPlay = () => {
        console.log(`${title} video can play`);
        if (!isPlaying && !hasError) {
          videoElement.play().catch(err => {
            console.error(`${title} canplay play error:`, err);
          });
        }
      };

      const handlePlay = () => {
        console.log(`${title} video started playing`);
        setIsPlaying(true);
      };

      const handlePause = () => {
        console.log(`${title} video paused`);
        setIsPlaying(false);
      };

      const handleError = (e) => {
        console.error(`${title} video error:`, e.target.error);
        setHasError(true);
      };

      const handleWaiting = () => {
        console.log(`${title} video waiting for data`);
      };

      const handleStalled = () => {
        console.log(`${title} video stalled`);
      };

      // Add all event listeners
      videoElement.addEventListener('loadstart', handleLoadStart);
      videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
      videoElement.addEventListener('canplay', handleCanPlay);
      videoElement.addEventListener('play', handlePlay);
      videoElement.addEventListener('pause', handlePause);
      videoElement.addEventListener('error', handleError);
      videoElement.addEventListener('waiting', handleWaiting);
      videoElement.addEventListener('stalled', handleStalled);

      return () => {
        clearTimeout(timeoutId);
        videoElement.removeEventListener('loadstart', handleLoadStart);
        videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
        videoElement.removeEventListener('canplay', handleCanPlay);
        videoElement.removeEventListener('play', handlePlay);
        videoElement.removeEventListener('pause', handlePause);
        videoElement.removeEventListener('error', handleError);
        videoElement.removeEventListener('waiting', handleWaiting);
        videoElement.removeEventListener('stalled', handleStalled);
        
        if (videoElement.srcObject) {
          videoElement.srcObject = null;
        }
      };
    }, [stream, isLocal, title, isPlaying, hasError]);

    return (
      <div style={{ position: 'relative' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          style={{
            width: isLocal ? '200px' : '400px',
            height: isLocal ? '150px' : '300px',
            border: `2px solid ${isLocal ? 'blue' : 'green'}`,
            backgroundColor: 'black',
            objectFit: 'cover'
          }}
        />
        {/* Status indicators */}
        {!isPlaying && !hasError && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'white',
            background: 'rgba(0,0,0,0.7)',
            padding: '5px 10px',
            borderRadius: '3px',
            fontSize: '12px'
          }}>
            Loading...
          </div>
        )}
        {hasError && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'red',
            background: 'rgba(0,0,0,0.7)',
            padding: '5px 10px',
            borderRadius: '3px',
            fontSize: '12px'
          }}>
            Video Error
          </div>
        )}
      </div>
    );
  });

  return (
    <div>
      <h1>Room Page</h1>
      <h4>{remoteSocketId ? 'You Are Connected' : 'No One in the Room'}</h4>
      {remoteSocketId && <button onClick={handleCallUser}>Call</button>}
      
      {/* Connection Status */}
      <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#f5f5f5', borderRadius: '5px' }}>
        <strong>Connection Status:</strong>
        <br />
        ICE State: <span style={{ color: iceConnectionState === 'connected' ? 'green' : 'orange' }}>
          {iceConnectionState}
        </span>
        <br />
        Connection State: <span style={{ color: connectionState === 'connected' ? 'green' : 'orange' }}>
          {connectionState}
        </span>
      </div>
      
      <div style={{ display: 'flex', gap: '20px', marginTop: '20px', flexWrap: 'wrap' }}>
        <div>
          <h4>My Stream</h4>
          {myStream ? (
            <VideoPlayer stream={myStream} isLocal={true} title="Local" />
          ) : (
            <div style={{ 
              width: '200px', 
              height: '150px', 
              border: '2px dashed gray',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#f0f0f0'
            }}>
              No local stream
            </div>
          )}
        </div>
        
        <div>
          <h4>Remote Stream</h4>
          {remoteStream ? (
            <VideoPlayer stream={remoteStream} isLocal={false} title="Remote" />
          ) : (
            <div style={{ 
              width: '400px', 
              height: '300px', 
              border: '2px dashed gray',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#f0f0f0'
            }}>
              No remote stream
            </div>
          )}
        </div>
      </div>
      
      {/* Debug and control section */}
      <div style={{ marginTop: '20px', padding: '10px', border: '1px solid #ccc', borderRadius: '5px' }}>
        <h4>Debug Controls</h4>
        <div style={{ marginBottom: '10px' }}>
          <button 
            onClick={() => {
              document.querySelectorAll('video').forEach(video => {
                if (video.srcObject) {
                  console.log('Forcing video play for:', video.srcObject.id);
                  video.play().catch(e => console.error('Force play failed:', e));
                }
              });
            }}
            style={{ marginRight: '10px' }}
          >
            Force Play All Videos
          </button>
          
          <button 
            onClick={() => {
              const remoteVideo = document.querySelector('video:not([muted])');
              if (remoteVideo) {
                remoteVideo.load();
                setTimeout(() => {
                  remoteVideo.play().catch(e => console.error('Reload play failed:', e));
                }, 100);
              }
            }}
            style={{ marginRight: '10px' }}
          >
            Reload Remote Video
          </button>

          <button 
            onClick={async () => {
              if (peer.peer) {
                const stats = await peer.peer.getStats();
                console.log('=== CONNECTION STATS ===');
                
                let videoReceived = false;
                let videoSent = false;
                
                stats.forEach(report => {
                  if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
                    console.log('📥 Inbound video stats:', {
                      bytesReceived: report.bytesReceived,
                      framesReceived: report.framesReceived,
                      framesDecoded: report.framesDecoded,
                      framesDropped: report.framesDropped,
                      timestamp: report.timestamp
                    });
                    videoReceived = report.bytesReceived > 0;
                  }
                  if (report.type === 'outbound-rtp' && report.mediaType === 'video') {
                    console.log('📤 Outbound video stats:', {
                      bytesSent: report.bytesSent,
                      framesSent: report.framesSent,
                      timestamp: report.timestamp
                    });
                    videoSent = report.bytesSent > 0;
                  }
                  if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                    console.log('🔗 Active candidate pair:', {
                      state: report.state,
                      bytesReceived: report.bytesReceived,
                      bytesSent: report.bytesSent
                    });
                  }
                });
                
                console.log('📊 Summary:', {
                  videoReceived,
                  videoSent,
                  iceState: peer.peer.iceConnectionState,
                  connectionState: peer.peer.connectionState
                });
              }
            }}
          >
            Check Connection Stats
          </button>

          <button 
            onClick={() => {
              if (peer.peer) {
                console.log('=== PEER CONNECTION DEBUG ===');
                console.log('Signalig State:', peer.peer.signalingState);
                console.log('ICE Connection State:', peer.peer.iceConnectionState);
                console.log('ICE Gathering State:', peer.peer.iceGatheringState);
                console.log('Connection State:', peer.peer.connectionState);
                
                const senders = peer.peer.getSenders();
                console.log('Senders:', senders.length);
                senders.forEach((sender, i) => {
                  console.log(`Sender ${i}:`, {
                    track: sender.track ? `${sender.track.kind} (${sender.track.readyState})` : 'null'
                  });
                });
                
                const receivers = peer.peer.getReceivers();
                console.log('Receivers:', receivers.length);
                receivers.forEach((receiver, i) => {
                  console.log(`Receiver ${i}:`, {
                    track: receiver.track ? `${receiver.track.kind} (${receiver.track.readyState})` : 'null'
                  });
                });
              }
            }}
            style={{ marginLeft: '10px' }}
          >
            Debug Peer Connection
          </button>
        </div>
        
        <div style={{ fontSize: '12px', lineHeight: '1.4' }}>
          <p><strong>Connection Info:</strong></p>
          <p>Remote Socket ID: {remoteSocketId || 'None'}</p>
          <p>My Stream: {myStream ? `Active (${myStream.getTracks().length} tracks)` : 'None'}</p>
          <p>Remote Stream: {remoteStream ? `Active (${remoteStream.getTracks().length} tracks)` : 'None'}</p>
          {remoteStream && (
            <div>
              <p><strong>Remote Stream Details:</strong></p>
              <p>Stream ID: {remoteStream.id}</p>
              {remoteStream.getTracks().map((track, index) => (
                <p key={index}>
                  Track {index + 1}: {track.kind} - {track.readyState} - 
                  {track.enabled ? ' enabled' : ' disabled'} - 
                  {track.muted ? ' muted' : ' unmuted'}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}