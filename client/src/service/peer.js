class PeerService {
    constructor() {
        if (!this.peer) {
            this.peer = new RTCPeerConnection({
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                    { urls: "stun:stun1.l.google.com:19302" },
                    { urls: "stun:stun2.l.google.com:19302" },
                    { urls: "stun:stun3.l.google.com:19302" }
                ],
                iceTransportPolicy: 'all',
                iceCandidatePoolSize: 5,
                bundlePolicy: 'max-bundle',
                rtcpMuxPolicy: 'require'
            });
            
            // Queue for pending ICE candidates
            this.pendingIceCandidates = [];
            
            // Add flags to prevent race conditions
            this.isNegotiating = false;
            this.makingOffer = false;
            this.ignoreOffer = false;
            
            this.setupEventHandlers();
        }
    }

    setupEventHandlers() {
        // Enhanced logging
        this.peer.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('ICE candidate generated:', {
                    type: event.candidate.type,
                    protocol: event.candidate.protocol,
                    address: event.candidate.address || 'hidden',
                    port: event.candidate.port
                });
            } else {
                console.log('ICE gathering complete');
            }
        };

        this.peer.oniceconnectionstatechange = () => {
            console.log('ICE connection state changed:', this.peer.iceConnectionState);
            
            if (this.peer.iceConnectionState === 'failed') {
                console.log('ICE connection failed, attempting restart...');
                this.peer.restartIce();
            }
        };

        this.peer.onconnectionstatechange = () => {
            console.log('Connection state changed:', this.peer.connectionState);
        };

        this.peer.onsignalingstatechange = () => {
            console.log('Signaling state changed:', this.peer.signalingState);
            // Reset negotiation flag when stable
            if (this.peer.signalingState === 'stable') {
                this.isNegotiating = false;
                this.makingOffer = false;
            }
        };

        this.peer.ontrack = (event) => {
            console.log('Track event received in peer service:', {
                kind: event.track?.kind,
                id: event.track?.id,
                streams: event.streams?.length || 0
            });
        };

        this.peer.ondatachannel = (event) => {
            console.log('Data channel received:', event.channel.label);
        };
    }

    async getOffer() {
        try {
            console.log('Creating offer...');
            console.log('Current signaling state:', this.peer.signalingState);
            
            // Check if we're already negotiating
            if (this.isNegotiating) {
                console.log('Already negotiating, skipping offer creation');
                return null;
            }
            
            this.makingOffer = true;
            console.log('Senders before offer:', this.peer.getSenders().length);
            
            const offer = await this.peer.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            
            console.log('Offer created:', {
                type: offer.type,
                sdpLength: offer.sdp.length,
                hasVideo: offer.sdp.includes('m=video'),
                hasAudio: offer.sdp.includes('m=audio')
            });
            
            // Check signaling state before setting local description
            if (this.peer.signalingState !== 'stable' && this.peer.signalingState !== 'have-local-offer') {
                console.log('Invalid state for setting local description:', this.peer.signalingState);
                this.makingOffer = false;
                return null;
            }
            
            console.log('Setting local description (offer)...');
            await this.peer.setLocalDescription(offer);
            console.log('Local description set successfully, state:', this.peer.signalingState);
            
            return offer;
        } catch (err) {
            console.error("Create offer error:", err);
            this.makingOffer = false;
            throw err;
        }
    }

    async getAnswer(offer) {
        try {
            console.log('Received offer:', {
                type: offer.type,
                sdpLength: offer.sdp?.length || 0,
                hasVideo: offer.sdp?.includes('m=video') || false,
                hasAudio: offer.sdp?.includes('m=audio') || false
            });
            
            const currentState = this.peer.signalingState;
            console.log('Current signaling state before processing offer:', currentState);
            
            // Handle perfect negotiation pattern
            const readyForOffer = currentState === 'stable' || 
                                (currentState === 'have-local-offer' && !this.makingOffer);
            
            if (!readyForOffer) {
                console.log('Not ready for offer, current state:', currentState, 'makingOffer:', this.makingOffer);
                if (currentState === 'have-local-offer') {
                    // This is a glare condition - both sides made offers
                    console.log('Glare condition detected');
                    if (!this.makingOffer) {
                        // We can accept the offer
                        await this.peer.setLocalDescription({type: 'rollback'});
                        console.log('Rolled back local offer due to glare');
                    } else {
                        // Ignore this offer
                        console.log('Ignoring offer due to glare condition');
                        return null;
                    }
                }
            }
            
            console.log('Setting remote description (offer)...');
            await this.peer.setRemoteDescription(new RTCSessionDescription(offer));
            console.log('Remote description set, new state:', this.peer.signalingState);
            
            // Process any pending ICE candidates
            await this.processPendingIceCandidates();
            
            console.log('Creating answer...');
            console.log('Senders before creating answer:', this.peer.getSenders().length);
            
            const answer = await this.peer.createAnswer();
            console.log('Answer created:', {
                type: answer.type,
                sdpLength: answer.sdp.length,
                hasVideo: answer.sdp.includes('m=video'),
                hasAudio: answer.sdp.includes('m=audio')
            });
            
            console.log('Setting local description (answer)...');
            await this.peer.setLocalDescription(answer);
            console.log('Answer set successfully, final state:', this.peer.signalingState);
            
            return answer;
        } catch (err) {
            console.error("Create answer error:", err);
            throw err;
        }
    }

    // In PeerService.js - modify setRemoteDescription
    async setRemoteDescription(ans) {
        try {
            console.log('Setting remote description (answer)...');
            console.log('Current signaling state:', this.peer.signalingState);
            
            // Only proceed if we're in a state that can accept an answer
            if (this.peer.signalingState !== 'have-local-offer') {
            console.warn('Not in correct state to set remote answer, current state:', this.peer.signalingState);
            // You might need to recreate the connection here
            this.recreate();
            return;
            }
            
            await this.peer.setRemoteDescription(new RTCSessionDescription(ans));
            console.log('Remote description (answer) set successfully, state:', this.peer.signalingState);
            
            await this.processPendingIceCandidates();
        } catch (err) {
            console.error("Set remote description error:", err);
            // Try recreating the connection on error
            this.recreate();
            throw err;
        }
    }
    async addIceCandidate(candidate) {
        try {
            console.log('Attempting to add ICE candidate:', {
                type: candidate.type || 'unknown',
                protocol: candidate.protocol || 'unknown',
                hasRemoteDesc: !!this.peer.remoteDescription,
                signalingState: this.peer.signalingState
            });

            // Check if remote description is properly set
            if (this.peer.remoteDescription && this.peer.remoteDescription.type) {
                console.log('Adding ICE candidate immediately');
                await this.peer.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('ICE candidate added successfully');
            } else {
                console.log('Remote description not ready, queuing candidate');
                this.pendingIceCandidates.push(candidate);
                console.log('Pending candidates queue size:', this.pendingIceCandidates.length);
            }
        } catch (err) {
            console.error("Error adding ICE candidate:", err);
            // Don't throw - failed ICE candidates shouldn't break the connection
        }
    }

    async processPendingIceCandidates() {
        if (this.pendingIceCandidates.length > 0) {
            console.log('Processing', this.pendingIceCandidates.length, 'pending ICE candidates');
            
            const candidates = [...this.pendingIceCandidates];
            this.pendingIceCandidates = [];
            
            for (const candidate of candidates) {
                try {
                    await this.peer.addIceCandidate(new RTCIceCandidate(candidate));
                    console.log('Processed pending ICE candidate:', candidate.type);
                } catch (err) {
                    console.error('Error processing pending ICE candidate:', err);
                }
            }
            
            console.log('All pending ICE candidates processed');
        }
    }

    // Helper method to safely create offer with state check
    async createOfferSafely() {
        if (this.peer.signalingState !== 'stable') {
            console.log('Cannot create offer, signaling state is:', this.peer.signalingState);
            return null;
        }
        
        if (this.isNegotiating) {
            console.log('Already negotiating, skipping offer');
            return null;
        }
        
        this.isNegotiating = true;
        return this.getOffer();
    }

    // Helper method to check if we can handle an offer
    canHandleOffer() {
        const state = this.peer.signalingState;
        return state === 'stable' || (state === 'have-local-offer' && !this.makingOffer);
    }

    async getStats() {
        try {
            const stats = await this.peer.getStats();
            return stats;
        } catch (err) {
            console.error("Error getting stats:", err);
            return null;
        }
    }

    isConnected() {
        const iceState = this.peer.iceConnectionState;
        const connectionState = this.peer.connectionState;
        const signalingState = this.peer.signalingState;
        
        console.log('Connection status check:', {
            iceState,
            connectionState,
            signalingState
        });
        
        return (iceState === 'connected' || iceState === 'completed') &&
               (connectionState === 'connected') &&
               (signalingState === 'stable');
    }

    getConnectionInfo() {
        return {
            iceConnectionState: this.peer.iceConnectionState,
            connectionState: this.peer.connectionState,
            signalingState: this.peer.signalingState,
            iceGatheringState: this.peer.iceGatheringState,
            senders: this.peer.getSenders().length,
            receivers: this.peer.getReceivers().length,
            pendingCandidates: this.pendingIceCandidates.length,
            isNegotiating: this.isNegotiating,
            makingOffer: this.makingOffer
        };
    }

    async restartIce() {
        try {
            console.log('Restarting ICE connection...');
            this.peer.restartIce();
        } catch (err) {
            console.error('Error restarting ICE:', err);
        }
    }

    close() {
        if (this.peer) {
            console.log('Closing peer connection...');
            
            this.pendingIceCandidates = [];
            this.isNegotiating = false;
            this.makingOffer = false;
            this.ignoreOffer = false;
            
            this.peer.close();
            this.peer = null;
            
            console.log('Peer connection closed');
        }
    }

    recreate() {
        console.log('Recreating peer connection...');
        this.close();
        this.constructor();
    }

    debugState() {
        const info = this.getConnectionInfo();
        console.log('=== PEER CONNECTION DEBUG STATE ===');
        console.log('ICE Connection State:', info.iceConnectionState);
        console.log('Connection State:', info.connectionState);
        console.log('Signaling State:', info.signalingState);
        console.log('ICE Gathering State:', info.iceGatheringState);
        console.log('Senders:', info.senders);
        console.log('Receivers:', info.receivers);
        console.log('Pending ICE Candidates:', info.pendingCandidates);
        console.log('Is Negotiating:', info.isNegotiating);
        console.log('Making Offer:', info.makingOffer);
        console.log('Has Remote Description:', !!this.peer.remoteDescription);
        console.log('Has Local Description:', !!this.peer.localDescription);
        console.log('=====================================');
    }
}

export default new PeerService();