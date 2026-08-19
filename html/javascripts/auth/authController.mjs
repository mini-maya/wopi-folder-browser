export function createAuthController({
	elements,
	appState,
	requestJson,
	formatDate,
	setStatus,
	resetFilesViewState,
	loadPage,
	closeViewer
}) {
	function renderAuthControls() {
		const authenticated = Boolean(appState.auth?.authenticated);
		const role = appState.auth?.user?.role || 'user';
		const currentContext = appState.auth?.storageContext || 'shared';

		elements.loginButton.classList.toggle('hidden', authenticated);
		elements.logoutButton.classList.toggle('hidden', !authenticated);
		elements.accountButton.classList.toggle('hidden', !authenticated);
		elements.adminButton.classList.toggle('hidden', !(authenticated && role === 'admin'));
		elements.myFilesButton.classList.toggle('hidden', !authenticated);
		elements.sharedFilesButton.classList.toggle('hidden', !authenticated);
		if (elements.recycleButton) {
			elements.recycleButton.classList.toggle('hidden', !authenticated);
			elements.recycleButton.disabled = !authenticated;
		}
		elements.myFilesButton.disabled = !authenticated || currentContext === 'personal';
		elements.sharedFilesButton.disabled = !authenticated || currentContext === 'shared';
		elements.myFilesButton.classList.toggle('is-active', authenticated && currentContext === 'personal');
		elements.sharedFilesButton.classList.toggle('is-active', authenticated && currentContext === 'shared');
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
		await closeViewer();
		await loadPage();
	}

	async function switchStorageContext(context) {
		await requestJson('/api/auth/storage-context', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ context: context })
		});
		if (resetFilesViewState) {
			resetFilesViewState();
		}
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
		if (appState.adminUsers.length === 0) {
			const row = document.createElement('tr');
			const cell = document.createElement('td');
			cell.colSpan = 5;
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
			row.append(usernameCell, roleCell, statusCell, createdCell, actionsCell);
			elements.adminUsersBody.appendChild(row);
		}
	}

	async function loadAdminUsers() {
		const payload = await requestJson('/api/admin/users');
		appState.adminUsers = payload.users || [];
		renderAdminUsers();
	}

	async function openAdminUserManagement() {
		elements.adminGeneratedPassword.textContent = '';
		elements.adminGeneratedPassword.classList.add('hidden');
		elements.adminCreateUserForm.reset();
		elements.adminCreateGeneratePassword.checked = true;
		elements.adminCreatePassword.disabled = true;
		await loadAdminUsers();
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
		switchStorageContext,
		openAccountModal,
		submitAccountForm,
		openAdminUserManagement,
		submitAdminCreateUserForm,
		closeModal
	};
}
