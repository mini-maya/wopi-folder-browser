export function createAuthController({
	elements,
	appState,
	requestJson,
	formatDate,
	setStatus,
	resetFilesViewState,
	clearDocuments,
	loadPage,
	closeViewer
}) {
	function renderAuthControls() {
		const authenticated = Boolean(appState.auth?.authenticated);
		const role = appState.auth?.user?.role || 'user';

		elements.loginButton.classList.toggle('hidden', authenticated);
		elements.logoutButton.classList.toggle('hidden', !authenticated);
		elements.accountButton.classList.toggle('hidden', !authenticated);
		elements.adminButton.classList.toggle('hidden', !(authenticated && role === 'admin'));
		if (elements.recycleButton) {
			elements.recycleButton.classList.toggle('hidden', !authenticated);
			elements.recycleButton.disabled = !authenticated;
		}
	}

	function applyPasswordPolicyToForms(minLength) {
		const effectiveMinLength = Number.isInteger(minLength) && minLength > 0 ? minLength : 12;
		elements.accountNewPassword.minLength = effectiveMinLength;
		elements.adminCreatePassword.minLength = effectiveMinLength;
		elements.accountNewPassword.placeholder = `At least ${effectiveMinLength} characters`;
		elements.adminCreatePassword.placeholder = `At least ${effectiveMinLength} characters`;
	}

	async function refreshAuthState() {
		appState.auth = await requestJson('/api/auth/me');
		renderAuthControls();
	}

	function openModal(modalElement) {
		modalElement.classList.remove('hidden');
		modalElement.setAttribute('aria-hidden', 'false');
	}

	function closeModal(modalElement) {
		modalElement.classList.add('hidden');
		modalElement.setAttribute('aria-hidden', 'true');
	}

	function openLoginModal() {
		elements.loginForm.reset();
		openModal(elements.loginModal);
		elements.loginUsername.focus();
	}

	function openAccountModal() {
		elements.accountForm.reset();
		openModal(elements.accountModal);
		elements.accountCurrentPassword.focus();
	}

	async function submitLoginForm(event) {
		event.preventDefault();
		const username = elements.loginUsername.value.trim();
		const password = elements.loginPassword.value;
		if (!username || !password) {
			setStatus('Username and password are required.', true);
			return;
		}
		await requestJson('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: username, password: password })
		});
		closeModal(elements.loginModal);
		await loadPage();
		if (appState.auth?.user?.must_change_password) {
			openAccountModal();
			setStatus('Please change your password now.', true);
		}
	}

	async function logoutCurrentUser() {
		await requestJson('/api/auth/logout', { method: 'POST' });
		clearDocuments();
		await closeViewer();
		await loadPage();
	}

	async function submitAccountForm(event) {
		event.preventDefault();
		const currentPassword = elements.accountCurrentPassword.value;
		const newPassword = elements.accountNewPassword.value;
		if (!currentPassword || !newPassword) {
			setStatus('Current and new password are required.', true);
			return;
		}
		await requestJson('/api/auth/change-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				currentPassword: currentPassword,
				newPassword: newPassword
			})
		});
		closeModal(elements.accountModal);
		setStatus('Password updated.');
		await refreshAuthState();
	}

	function renderAdminUsers() {
		elements.adminUsersBody.innerHTML = '';
		const availableMounts = Array.isArray(appState.adminMounts) && appState.adminMounts.length > 0
			? appState.adminMounts
			: (Array.isArray(appState.mounts) ? appState.mounts : []);
		if (appState.adminUsers.length === 0) {
			const row = document.createElement('tr');
			const cell = document.createElement('td');
			cell.colSpan = 6;
			cell.textContent = 'No users found.';
			row.appendChild(cell);
			elements.adminUsersBody.appendChild(row);
			return;
		}

		for (const user of appState.adminUsers) {
			const row = document.createElement('tr');
			const usernameCell = document.createElement('td');
			usernameCell.textContent = user.username;
			const roleCell = document.createElement('td');
			roleCell.textContent = user.role;
			const statusCell = document.createElement('td');
			statusCell.textContent = user.active ? 'active' : 'disabled';
			const createdCell = document.createElement('td');
			createdCell.textContent = formatDate(user.created_at);
			const mountCell = document.createElement('td');
			const mountList = document.createElement('div');
			mountList.className = 'admin-mount-list';
			const userMounts = new Set(Array.isArray(user.mounts) ? user.mounts.map((id) => String(id)) : []);
			if (availableMounts.length === 0) {
				mountList.textContent = 'No mounts available.';
			} else {
				for (const mount of availableMounts) {
					const label = document.createElement('label');
					label.className = 'checkbox-field';
					const checkbox = document.createElement('input');
					const mountId = String(mount.id);
					checkbox.type = 'checkbox';
					checkbox.checked = userMounts.has(mountId);
					checkbox.disabled = !user.active;
					checkbox.title = user.active
						? `Grant access to mount ${mount.name}.`
						: 'Enable the user account before granting mount access.';
					checkbox.addEventListener('change', async function() {
						const currentMounts = new Set(Array.isArray(user.mounts) ? user.mounts.map((id) => String(id)) : []);
						const nextMounts = new Set(currentMounts);
						if (checkbox.checked) {
							nextMounts.add(mountId);
						} else {
							nextMounts.delete(mountId);
						}
						checkbox.disabled = true;
						try {
							const payload = await requestJson(`/api/admin/users/${encodeURIComponent(user.id)}/mounts`, {
								method: 'PUT',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ mounts: [...nextMounts] })
							});
							user.mounts = Array.isArray(payload?.mounts) ? payload.mounts : [...nextMounts];
							if (appState.auth?.user?.id === user.id) {
								appState.auth.user.mounts = user.mounts.slice();
								const currentPathMount = window.location.pathname.match(/^\/mount\/([^/]+)/)?.[1];
								const currentUrlMountId = currentPathMount ? decodeURIComponent(currentPathMount) : null;
								const stillHasCurrentMount = !currentUrlMountId || user.mounts.some((id) => String(id) === String(currentUrlMountId));
								if (!stillHasCurrentMount) {
									const fallbackMount = Array.isArray(appState.mounts) && appState.mounts.length > 0
										? appState.mounts.find((mount) => user.mounts.some((id) => String(id) === String(mount.id)))
										: null;
									const fallbackMountId = fallbackMount?.id || null;
									appState.currentMountId = fallbackMountId || 'documents';
									if (fallbackMountId) {
										window.history.replaceState({}, '', `/mount/${encodeURIComponent(fallbackMountId)}`);
									} else {
										window.history.replaceState({}, '', '/');
									}
									await loadPage();
									return;
								}
							}
							renderAdminUsers();
							setStatus(`Mount permissions for "${user.username}" updated.`);
						} catch (error) {
							checkbox.checked = currentMounts.has(mountId);
							setStatus(error.message, true);
						} finally {
							checkbox.disabled = !user.active;
						}
					});
					label.appendChild(checkbox);
					label.appendChild(document.createTextNode(` ${mount.name}`));
					mountList.appendChild(label);
				}
			}
			mountCell.appendChild(mountList);
			const actionsCell = document.createElement('td');
			const actionContainer = document.createElement('div');
			actionContainer.className = 'admin-user-actions';

			const toggleButton = document.createElement('button');
			toggleButton.type = 'button';
			toggleButton.className = 'secondary';
			toggleButton.textContent = user.active ? 'Disable' : 'Enable';
			toggleButton.addEventListener('click', async function() {
				try {
					await requestJson(`/api/admin/users/${encodeURIComponent(user.id)}`, {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ active: !user.active })
					});
					await loadAdminUsers();
				} catch (error) {
					setStatus(error.message, true);
				}
			});

			const resetButton = document.createElement('button');
			resetButton.type = 'button';
			resetButton.className = 'secondary';
			resetButton.textContent = 'Reset password';
			resetButton.addEventListener('click', async function() {
				try {
					const payload = await requestJson(`/api/admin/users/${encodeURIComponent(user.id)}/reset-password`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ generatePassword: true })
					});
					elements.adminGeneratedPassword.textContent = payload.generatedPassword
						? `New password (show once): ${payload.generatedPassword}`
						: 'Password reset.';
					elements.adminGeneratedPassword.classList.remove('hidden');
				} catch (error) {
					setStatus(error.message, true);
				}
			});

			const deleteButton = document.createElement('button');
			deleteButton.type = 'button';
			deleteButton.className = 'danger';
			deleteButton.textContent = 'Delete';
			deleteButton.disabled = appState.auth?.user?.id === user.id;
			deleteButton.addEventListener('click', async function() {
				try {
					await requestJson(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
					await loadAdminUsers();
				} catch (error) {
					setStatus(error.message, true);
				}
			});

			actionContainer.append(toggleButton, resetButton, deleteButton);
			actionsCell.appendChild(actionContainer);
			row.append(usernameCell, roleCell, statusCell, createdCell, mountCell, actionsCell);
			elements.adminUsersBody.appendChild(row);
		}
	}

	async function loadAdminUsers() {
		const payload = await requestJson('/api/admin/users');
		appState.adminUsers = payload.users || [];
		renderAdminUsers();
	}

	async function loadAdminMounts() {
		const payload = await requestJson('/api/admin/mounts');
		appState.adminMounts = Array.isArray(payload?.mounts) ? payload.mounts : [];
		renderAdminUsers();
	}

	async function openAdminUserManagement() {
		elements.adminGeneratedPassword.textContent = '';
		elements.adminGeneratedPassword.classList.add('hidden');
		elements.adminCreateUserForm.reset();
		elements.adminCreateGeneratePassword.checked = true;
		elements.adminCreatePassword.disabled = true;
		await Promise.all([
			loadAdminUsers(),
			loadAdminMounts()
		]);
		renderAdminUsers();
		openModal(elements.adminModal);
	}

	async function submitAdminCreateUserForm(event) {
		event.preventDefault();
		const username = elements.adminCreateUsername.value.trim();
		const role = elements.adminCreateRole.value === 'admin' ? 'admin' : 'user';
		const generate = elements.adminCreateGeneratePassword.checked;
		const password = elements.adminCreatePassword.value;
		if (!username) {
			setStatus('Username is required.', true);
			return;
		}
		if (!generate && !password) {
			setStatus('Password is required if generation is disabled.', true);
			return;
		}
		const payload = await requestJson('/api/admin/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: username,
				role: role,
				generatePassword: generate,
				password: generate ? undefined : password
			})
		});
		elements.adminGeneratedPassword.textContent = payload.generatedPassword
			? `Initial password (show once): ${payload.generatedPassword}`
			: 'User created.';
		elements.adminGeneratedPassword.classList.remove('hidden');
		elements.adminCreateUserForm.reset();
		elements.adminCreateGeneratePassword.checked = true;
		elements.adminCreatePassword.disabled = true;
		await loadAdminUsers();
	}

	return {
		renderAuthControls,
		applyPasswordPolicyToForms,
		openLoginModal,
		submitLoginForm,
		logoutCurrentUser,
		openAccountModal,
		submitAccountForm,
		openAdminUserManagement,
		submitAdminCreateUserForm,
		closeModal
	};
}
