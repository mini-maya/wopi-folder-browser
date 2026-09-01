// The currently selected mount is tracked purely in memory (not in the URL),
// so it resets to the default mount on every full page load instead of being
// "remembered" across visits.
let currentMountId = null;

export function setCurrentMountId(mountId) {
	currentMountId = mountId || null;
}

export function getCurrentMountId() {
	return currentMountId;
}
