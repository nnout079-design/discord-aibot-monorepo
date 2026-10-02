import crypto from 'crypto';

export interface LastFmTrack {
	name: string;
	artist: string;
	album?: string;
	url: string;
	image?: string[];
	playcount?: number;
	listeners?: number;
	durationMs?: number;
	tags?: string[];
}

export interface LastFmUser {
	name: string;
	url: string;
	playcount: number;
	image?: string[];
	country?: string;
	age?: number;
	registered?: {
		unixtime: number;
		'#text': string;
	};
}

export interface LastFmRecentTrack {
	name: string;
	artist: {
		'#text': string;
	};
	album?: {
		'#text': string;
	};
	url: string;
	image?: Array<{ '#text': string; size: string }>;
	'@attr'?: {
		nowplaying?: string;
	};
	date?: {
		uts: number;
		'#text': string;
	};
}

export class LastFmApi {
	private apiKey: string;
	private apiSecret: string;
	private baseUrl = 'https://ws.audioscrobbler.com/2.0/';

	constructor(apiKey: string, apiSecret: string) {
		this.apiKey = apiKey;
		this.apiSecret = apiSecret;
	}

	private async makeRequest(params: Record<string, string>): Promise<any> {
		const url = new URL(this.baseUrl);
		Object.entries(params).forEach(([key, value]) => {
			url.searchParams.append(key, value);
		});

		const response = await fetch(url.toString());
		if (!response.ok) {
			throw new Error(`Last.fm API error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		if (data.error) {
			throw new Error(`Last.fm API error: ${data.message}`);
		}

		return data;
	}

	async getTrackInfo(track: string, artist: string): Promise<LastFmTrack> {
		const params = {
			method: 'track.getInfo',
			api_key: this.apiKey,
			artist: artist,
			track: track,
			format: 'json'
		};

		const data = await this.makeRequest(params);
		const trackData = data.track;

		return {
			name: trackData.name,
			artist: trackData.artist.name,
			album: trackData.album?.name,
			url: trackData.url,
			image: trackData.image?.map((img: any) => img['#text']),
			playcount: parseInt(trackData.playcount),
			listeners: parseInt(trackData.listeners),
			durationMs: Number(trackData.duration) || undefined,
			tags: trackData.toptags?.tag?.map((tag: any) => tag.name) ?? []
		};
	}

	async getUserInfo(username: string): Promise<LastFmUser> {
		const params = {
			method: 'user.getInfo',
			api_key: this.apiKey,
			user: username,
			format: 'json'
		};

		const data = await this.makeRequest(params);
		const userData = data.user;

		return {
			name: userData.name,
			url: userData.url,
			playcount: parseInt(userData.playcount),
			image: userData.image?.map((img: any) => img['#text']),
			country: userData.country,
			age: userData.age ? parseInt(userData.age) : undefined,
			registered: userData.registered
		};
	}

	async getRecentTracks(username: string, limit: number = 10): Promise<LastFmRecentTrack[]> {
		const params = {
			method: 'user.getRecentTracks',
			api_key: this.apiKey,
			user: username,
			limit: limit.toString(),
			format: 'json'
		};

		const data = await this.makeRequest(params);
		return data.recenttracks.track || [];
	}

	async getTopTracks(username: string, limit: number = 10): Promise<LastFmTrack[]> {
		const params = {
			method: 'user.getTopTracks',
			api_key: this.apiKey,
			user: username,
			limit: limit.toString(),
			format: 'json'
		};

		const data = await this.makeRequest(params);
		const tracks = data.toptracks.track || [];

		return tracks.map((track: any) => ({
			name: track.name,
			artist: track.artist.name,
			album: track.album?.name,
			url: track.url,
			image: track.image?.map((img: any) => img['#text']),
			playcount: parseInt(track.playcount),
			listeners: parseInt(track.listeners)
		}));
	}

	async scrobble(
		track: string,
		artist: string,
		album?: string,
		timestamp?: number,
		sessionKey?: string
	): Promise<boolean> {
		if (!sessionKey) {
			throw new Error('Session key required for scrobbling');
		}

		const params: Record<string, string> = {
			method: 'track.scrobble',
			track: track,
			artist: artist,
			timestamp: timestamp?.toString() || Math.floor(Date.now() / 1000).toString(),
			api_key: this.apiKey,
			sk: sessionKey
		};

		if (album) {
			params.album = album;
		}

		const signature = this.generateSignature(params);
		params.api_sig = signature;

		const data = await this.makeRequest(params);
		return data.scrobbles['@attr'].ignored === '0';
	}

	private generateSignature(params: Record<string, string>): string {
		const sortedKeys = Object.keys(params).filter(key => key !== 'format').sort();
		const signatureString = sortedKeys
			.map(key => `${key}${params[key]}`)
			.join('') + this.apiSecret;

		return crypto.createHash('md5').update(signatureString).digest('hex');
	}

	async getAuthToken(): Promise<string> {
		const params = {
			method: 'auth.getToken',
			api_key: this.apiKey,
			format: 'json'
		};

		const data = await this.makeRequest(params);
		return data.token;
	}

	async getSession(authToken: string): Promise<{ key: string; name: string }> {
		        const params: Record<string, string> = {
			method: 'auth.getSession',
			api_key: this.apiKey,
			token: authToken,
			format: 'json'
		};

		const signature = this.generateSignature(params);
		params.api_sig = signature;

		const data = await this.makeRequest(params);
		return {
			key: data.session.key,
			name: data.session.name
		};
	}
}

export function createLastFmApi(): LastFmApi | null {
	const apiKey = process.env.LASTFM_API_KEY;
	const apiSecret = process.env.LASTFM_API_SECRET;

	if (!apiKey || !apiSecret) {
		console.error('LASTFM_API_KEY and LASTFM_API_SECRET must be set');
		return null;
	}

	return new LastFmApi(apiKey, apiSecret);
}
