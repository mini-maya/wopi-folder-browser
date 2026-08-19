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

	function renderConsistencyReport(report, target = elements.adminConsistencyReport) {
		if (!target) {
		  return;
		}
		target.innerHTML = '';
		target.classList.remove('hidden');

		const filterOrder = ['All', 'Files', 'Registry', 'Recycled', 'Preview', 'Activities'];
		const severityOrder = [
		  { value: 'all', label: 'All' },
		  { value: 'error', label: 'Error' },
		  { value: 'warning', label: 'Warning' },
		  { value: 'info', label: 'Info' }
		];
		const issueGroups = new Map();

		function getIssueGroup(issue) {
		  const source = String(issue.source || '').toLowerCase();
		  if (source === 'filesystem') {
		    return 'Files';
		  }
		  if (source.includes('file-registry')) {
		    return 'Registry';
		  }
		  if (source.includes('recycled')) {
		    return 'Recycled';
		  }
		  if (source.includes('preview')) {
		    return 'Preview';
		  }
		  if (source.includes('activity')) {
		    return 'Activities';
		  }
		  if (issue.path && /^.*\.(odt|ods|odp|docx|xlsx|pptx|txt|csv)$/i.test(issue.path)) {
		    return 'Files';
		  }
		  return 'Files';
		}

		const issues = Array.isArray(report.issues) ? report.issues : [];
		for (const issue of issues) {
		  const groupName = getIssueGroup(issue);
		  if (!issueGroups.has(groupName)) {
		    issueGroups.set(groupName, []);
		  }
		  issueGroups.get(groupName).push(issue);
		}

		const summary = document.createElement('div');
		summary.className = 'admin-consistency-summary';
		const summaryText = document.createElement('div');
		const scopeLabel = report.scope === 'all' ? 'All contexts' : 'Current context';
		summaryText.innerHTML = `
		  <strong>${report.status === 'ok' ? 'State is consistent' : 'Consistency issues found'}</strong>
		  <div class="admin-consistency-totals">
		    <span>Scope: ${scopeLabel}</span>
		    <span>Files: ${report.summary?.totalFiles ?? 0}</span>
		    <span>Registry: ${report.summary?.totalRegistryEntries ?? 0}</span>
		    <span>Issues: ${report.summary?.issueCount ?? 0}</span>
		  </div>
		`;

		const status = document.createElement('span');
		status.className = `admin-consistency-status ${report.status}`;
		status.textContent = report.status === 'ok' ? 'OK' : 'Check';
		summary.append(summaryText, status);

		const actionRow = document.createElement('div');
		actionRow.className = 'admin-consistency-actions-row';

		const downloadButton = document.createElement('button');
		downloadButton.type = 'button';
		downloadButton.className = 'secondary';
		downloadButton.textContent = 'Download report';
		downloadButton.addEventListener('click', function() {
		  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
		  const url = URL.createObjectURL(blob);
		  const anchor = document.createElement('a');
		  anchor.href = url;
		  anchor.download = `documents-consistency-${new Date().toISOString().slice(0, 10)}.json`;
		  document.body.appendChild(anchor);
		  anchor.click();
		  anchor.remove();
		  URL.revokeObjectURL(url);
		});

		const filterBar = document.createElement('div');
		filterBar.className = 'admin-consistency-filters';
		const severityFilterBar = document.createElement('div');
		severityFilterBar.className = 'admin-consistency-filters admin-consistency-severity-filters';

		let activeFilter = 'All';
		let activeSeverity = 'all';
		const groupContainer = document.createElement('div');
		groupContainer.className = 'admin-consistency-groups';

		function issueMatchesFilters(issue, groupName) {
		  const matchesTopic = activeFilter === 'All' || activeFilter === groupName;
		  const matchesSeverity = activeSeverity === 'all' || String(issue.severity || 'warning') === activeSeverity;
		  return matchesTopic && matchesSeverity;
		}

		function renderIssueGroups() {
		  groupContainer.innerHTML = '';
		  const visibleGroups = filterOrder.filter((name) => name === 'All' || issueGroups.has(name));
		  let renderedGroupCount = 0;
		  for (const groupName of visibleGroups) {
		    if (groupName === 'All') {
		      continue;
		    }
		    const matchingIssues = (issueGroups.get(groupName) || []).filter((issue) => issueMatchesFilters(issue, groupName));
		    if (matchingIssues.length === 0) {
		      continue;
		    }

		    const section = document.createElement('section');
		    section.className = 'admin-consistency-group';
		    const header = document.createElement('h5');
		    header.textContent = `${groupName} (${matchingIssues.length})`;
		    const list = document.createElement('ul');
		    list.className = 'admin-consistency-issues';

		    for (const issue of matchingIssues) {
		      const item = document.createElement('li');
		      item.className = 'admin-consistency-issue';
		          item.style.display = 'flex';
		          item.style.alignItems = 'center';
		          item.style.justifyContent = 'space-between';
		          item.style.gap = '12px';

		          const content = document.createElement('div');
		          content.style.flex = '1';
		          const title = document.createElement('strong');
		          title.textContent = `${issue.severity || 'warning'} · ${issue.type}`;
		          const message = document.createElement('div');
		          message.textContent = issue.message;
		          const meta = document.createElement('small');
		          const sourceText = issue.source || 'unknown';
		          const detailSegments = [];
		          if (issue.path) {
		            detailSegments.push(issue.path);
		          }
		          if (issue.fileId) {
		            detailSegments.push(issue.fileId);
		          }
		          meta.textContent = detailSegments.length ? `${sourceText} · ${detailSegments.join(' · ')}` : sourceText;
		          content.append(title, message, meta);
		          item.appendChild(content);

		          const actionContainer = document.createElement('div');
		          actionContainer.style.display = 'flex';
		          actionContainer.style.alignItems = 'center';
		          actionContainer.style.justifyContent = 'flex-end';
		          actionContainer.style.marginLeft = 'auto';

		          const issueActions = Array.isArray(issue.actions) ? issue.actions : [];
		          for (const action of issueActions) {
		            const actionButton = document.createElement('button');
		            actionButton.type = 'button';
		            actionButton.className = 'secondary';
		            actionButton.textContent = action.label || 'Action';
		            actionButton.addEventListener('click', async function() {
		              try {
		                const payload = await requestJson('/api/admin/state-consistency/cleanup', {
		                  method: 'POST',
		                  headers: { 'Content-Type': 'application/json' },
		                  body: JSON.stringify({
		                    fileId: issue.fileId || null,
		                    relativePath: issue.path || null
		                  })
		                });
		                const removed = Boolean(payload?.removed);
		                setStatus(removed
		                  ? 'Stale document state removed successfully.'
		                  : 'No stale state entries were removed.', !removed);
		                await runConsistencyCheck();
		              } catch (error) {
		                setStatus(error.message, true);
		              }
		            });
		            actionContainer.appendChild(actionButton);
		          }

		          if (actionContainer.childElementCount > 0) {
		            item.appendChild(actionContainer);
		          }
		          list.appendChild(item);
		    }

		    if (!issueGroups.get(groupName)?.length) {
		      const item = document.createElement('li');
		      item.className = 'admin-consistency-issue';
		      item.textContent = 'No issues in this topic.';
		      list.appendChild(item);
		    }

		    section.append(header, list);
		    groupContainer.appendChild(section);
		    renderedGroupCount += 1;
		  }

		  if (renderedGroupCount === 0) {
		    const item = document.createElement('li');
		    item.className = 'admin-consistency-issue';
		    item.textContent = 'No issues match the selected filters.';
		    const list = document.createElement('ul');
		    list.className = 'admin-consistency-issues';
		    list.appendChild(item);
		    groupContainer.appendChild(list);
		  }
		}

		for (const label of filterOrder) {
		  const button = document.createElement('button');
		  button.type = 'button';
		  button.className = 'secondary admin-consistency-filter';
		  button.textContent = label;
		  const count = label === 'All' ? issues.length : (issueGroups.get(label)?.length || 0);
		  button.setAttribute('data-filter', label);
		  button.classList.toggle('is-selected', label === activeFilter);
		  if (count === 0 && label !== 'All') {
		    button.disabled = true;
		  }
		  button.addEventListener('click', function() {
		    activeFilter = label;
		    for (const child of filterBar.querySelectorAll('.admin-consistency-filter')) {
		      child.classList.toggle('is-selected', child.dataset.filter === label);
		    }
		    renderIssueGroups();
		  });
		  filterBar.appendChild(button);
		}

		for (const entry of severityOrder) {
		  const button = document.createElement('button');
		  button.type = 'button';
		  button.className = 'secondary admin-consistency-filter';
		  button.textContent = entry.label;
		  const count = entry.value === 'all'
		    ? issues.length
		    : issues.filter((issue) => String(issue.severity || 'warning') === entry.value).length;
		  button.setAttribute('data-filter', entry.value);
		  button.classList.toggle('is-selected', entry.value === activeSeverity);
		  if (count === 0 && entry.value !== 'all') {
		    button.disabled = true;
		  }
		  button.addEventListener('click', function() {
		    activeSeverity = entry.value;
		    for (const child of severityFilterBar.querySelectorAll('.admin-consistency-filter')) {
		      child.classList.toggle('is-selected', child.dataset.filter === entry.value);
		    }
		    renderIssueGroups();
		  });
		  severityFilterBar.appendChild(button);
		}

		if (issues.length === 0) {
		  const item = document.createElement('li');
		  item.className = 'admin-consistency-issue';
		  item.textContent = 'No mismatches found between the filesystem and the JSON state files.';
		  const list = document.createElement('ul');
		  list.className = 'admin-consistency-issues';
		  list.appendChild(item);
		  groupContainer.appendChild(list);
		} else {
		  renderIssueGroups();
		}

		filterBar.hidden = false;
		severityFilterBar.hidden = false;
		groupContainer.hidden = false;
		actionRow.append(downloadButton, filterBar, severityFilterBar);
		target.append(summary, actionRow, groupContainer);
	}

	async function runConsistencyCheck() {
		const allContexts = Boolean(elements.adminConsistencyAllContexts?.checked);
		const report = await requestJson('/api/admin/state-consistency', {
		  method: 'POST',
		  headers: { 'Content-Type': 'application/json' },
		  body: JSON.stringify({ allContexts: allContexts })
		});
		if (elements.adminConsistencyModal && elements.adminConsistencyModalContent) {
		  elements.adminConsistencyModalContent.innerHTML = '';
		  renderConsistencyReport(report, elements.adminConsistencyModalContent);
		  elements.adminConsistencyModal.classList.remove('hidden');
		  elements.adminConsistencyModal.setAttribute('aria-hidden', 'false');
		  elements.adminConsistencyCancel.focus();
		} else {
		  renderConsistencyReport(report, elements.adminConsistencyReport);
		}
		setStatus(report.status === 'ok'
		  ? 'State consistency check passed.'
		  : `State consistency check found ${report.summary?.issueCount ?? 0} issues.`, report.status !== 'ok');
	}

	async function openAdminUserManagement() {
		elements.adminGeneratedPassword.textContent = '';
		elements.adminGeneratedPassword.classList.add('hidden');
		elements.adminCreateUserForm.reset();
		elements.adminCreateGeneratePassword.checked = true;
		elements.adminCreatePassword.disabled = true;
		if (elements.adminConsistencyReport) {
		  elements.adminConsistencyReport.classList.add('hidden');
		  elements.adminConsistencyReport.innerHTML = '';
		}
		if (elements.adminConsistencyAllContexts) {
		  elements.adminConsistencyAllContexts.checked = false;
		}
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
		runConsistencyCheck,
		closeModal
	};
}
