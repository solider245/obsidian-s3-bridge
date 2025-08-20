import { App } from 'obsidian'

const DATA_FILE = 'data.json'

export interface ActivityDetails {
	url?: string
	fileName?: string
	source?: 'paste' | 'command' | 'clipboard' | 'paste_unexpected'
	size?: number
	duration?: number
	error?: string
	message?: string
	[key: string]: unknown
}

export interface Activity {
	timestamp: string
	event: 'upload_success' | 'upload_error' | 'cleanup_manual' | 'info' | 'warn'
	details: ActivityDetails
}

async function readData(app: App): Promise<{ activities: Activity[] }> {
	try {
		const content = await app.vault.adapter.read(DATA_FILE)
		const data = JSON.parse(content)
		return data && Array.isArray(data.activities) ? data : { activities: [] }
	} catch (e) {
		// If file doesn't exist or is invalid, start with an empty structure
		return { activities: [] }
	}
}

async function writeData(app: App, data: { activities: Activity[] }): Promise<void> {
	try {
		await app.vault.adapter.write(DATA_FILE, JSON.stringify(data, null, 2))
	} catch (e) {
		console.error('Failed to write to data.json', e)
	}
}

export const activityLog = {
	async add(app: App, event: Activity['event'], details: ActivityDetails): Promise<void> {
		const data = await readData(app)
		const newActivity: Activity = {
			timestamp: new Date().toISOString(),
			event,
			details,
		}
		data.activities.unshift(newActivity) // Add to the beginning
		// Optional: Trim the log to a certain size if needed
		// data.activities = data.activities.slice(0, 500);
		await writeData(app, data)
	},

	async get(app: App): Promise<Activity[]> {
		const data = await readData(app)
		return data.activities
	},

	async delete(app: App, timestamp: string): Promise<void> {
		const data = await readData(app)
		data.activities = data.activities.filter(log => log.timestamp !== timestamp)
		await writeData(app, data)
	},

	async clear(app: App): Promise<void> {
		await writeData(app, { activities: [] })
	},
}
