declare global {
	interface Window {
		__obS3_config__?: Record<string, any>
		__obS3_maxUploadMB__?: number
		__obS3_presignTimeout__?: number
		__obS3_uploadTimeout__?: number
	}
}

export {}
