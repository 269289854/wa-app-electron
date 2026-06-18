# wa-app WebUI Migration Parity

This file is the handoff record for keeping the Electron desktop client in sync with the upstream web UI from `pood1e/wa-app`.

## Current Sync Point

- Upstream repository: `https://github.com/pood1e/wa-app`
- Upstream commit audited: `702129d2be20d3f20b7049c96c4d8ad2cecff3ec`
- Upstream commit date: `2026-06-19T00:44:46+08:00`
- Upstream commit subject: `Remove WA long connection lease coordination`
- Desktop repository commit after parity work: `6395ba6`
- Desktop branch at audit time: `codex/electron-client-phase-1`
- Audit date: `2026-06-19`

## Audit Result

All currently working `webui/src/dashboard` WA features from upstream are represented in the desktop client.

The upstream WebUI API surface used by `webui/src/dashboard/wa-api.ts` is covered by desktop helpers or calls in `src/api.ts`, `src/app/App.tsx`, and `src/features/*`.

Covered upstream endpoint families:

- `/api/wa/accounts`
- `/api/wa/accounts/:id/profile-picture`
- `/api/wa/account-otp-messages`
- `/api/wa/client-profiles`
- `/api/wa/contacts`
- `/api/wa/contacts/:id`
- `/api/wa/contacts/:id/profile-picture`
- `/api/wa/contacts/resolve`
- `/api/wa/messages`
- `/api/wa/messages/read`
- `/api/wa/messages/delete`
- `/api/wa/messages/send`
- `/api/wa/long-connections`
- `/api/wa/phone/sms-probe`
- `/api/wa/register`
- `/api/wa/login-state-check`
- `/api/wa/actions/registration/resume-otp`
- `/api/wa/actions/registration/account-transfer/refresh`
- `/api/wa/actions/registration/account-transfer/poll`
- `/api/wa/account-settings/2fa/status`
- `/api/wa/account-settings/2fa`
- `/api/wa/account-settings/email`
- `/api/wa/account-settings/email/otp/request`
- `/api/wa/account-settings/email/otp/verify`
- `/api/wa/account-settings/profile/name`
- `/api/wa/account-settings/profile/picture`
- `/api/wa/account-settings/profile/picture/remove`

Desktop-only or desktop-expanded WA capabilities:

- `/api/wa/actions/registration/cleanup-failed-account`
- `/api/wa/actions/registration/persist-login-state`
- Local/remote service configuration and local `wa-app-service` process control
- SMSBower/Hero-SMS platform registration
- OpenAI phone occupancy check bridge
- SMS activation cancel queue
- Electron package and mock UI smoke tests

## Feature Mapping

| Upstream WebUI area | Upstream files | Desktop implementation | Status |
| --- | --- | --- | --- |
| Account rail, list, pagination, search, delete | `wa-account-rail.tsx`, `wa-page.tsx`, `wa-account-info-page.tsx` | `src/app/App.tsx`, `src/features/accounts/`, `src/api.ts` | Synced |
| Account profile and info | `wa-account-detail.tsx`, `wa-account-profile-settings.tsx` | `src/features/accounts/AccountPanel.tsx`, `src/features/accounts/AccountWidgets.tsx` | Synced |
| Profile picture display/upload/remove | `wa-account-avatar.tsx`, `wa-account-profile-settings.tsx`, `wa-api.ts` | `src/features/accounts/AccountWidgets.tsx`, `src/shared/avatar.ts`, profile APIs | Synced |
| 2FA PIN and account email | `wa-account-security.tsx`, `wa-account-security-model.ts` | `src/features/accounts/AccountWidgets.tsx`, account settings APIs | Synced |
| Email OTP request/verify | `wa-account-security.tsx` | `src/features/accounts/AccountWidgets.tsx`, `requestEmailOtp`, `verifyEmailOtp` | Synced |
| Login state check | `wa-api.ts` | `src/features/accounts/AccountWidgets.tsx`, `checkLoginState` | Synced |
| Device fingerprint/client profiles | `wa-device-fingerprint.tsx` | `src/features/accounts/AccountWidgets.tsx` | Synced |
| Long connection badge/status | `wa-long-connection-badge.tsx` | account rail status and connection query in `src/app/App.tsx` / `src/features/accounts/AccountRow.tsx` | Synced |
| Contacts list and auto-resolve | `wa-contact-list.tsx`, `wa-contact-resolve.ts` | `src/features/chat/ChatPanel.tsx`, `src/features/chat/contact-model.ts` | Synced |
| Chat thread, rich text, send message | `wa-chat-thread.tsx`, `wa-message-content.tsx`, `wa-chat-model.ts` | `src/features/chat/ChatPanel.tsx`, message APIs | Synced |
| Mark read/delete message/delete contact | `wa-inbox.tsx`, `wa-api.ts` | `src/features/chat/ChatPanel.tsx`, `markMessagesRead`, `deleteMessages`, `deleteContact` | Synced |
| Account OTP messages | `wa-contact-otp-banner.tsx`, `wa-inbox.tsx` | `src/features/accounts/AccountWidgets.tsx`, OTP query, mock smoke coverage | Synced |
| Phone probe and registration | `wa-account-add.tsx`, `wa-registration-channel-buttons.tsx`, `wa-result-model.ts` | `src/features/registration/AddAccountPanel.tsx`, `src/features/registration/registration-task.ts`, `src/result-model.ts` | Synced |
| Registration OTP resume | `wa-registration-otp-card.tsx`, `wa-account-detail.tsx` | `src/features/registration/AddAccountPanel.tsx`, `ManualOtpCard` in `src/features/accounts/AccountWidgets.tsx` | Synced |
| Account transfer challenge during registration | `wa-api.ts`, registration response model | `src/features/registration/RegistrationRecoveryPanel.tsx`, `src/features/registration/workflow-model.ts` | Synced |
| Registration cleanup/persist login state | Upstream backend action, not WebUI surfaced in the audited commit | `src/features/registration/RegistrationRecoveryPanel.tsx` | Desktop expanded |

## Code Organization Map

Use these entry points before making desktop changes:

- `src/main.tsx`: React root only (`QueryClientProvider`, `HashRouter`, `App` mount).
- `src/app/App.tsx`: desktop shell, sidebar account rail, top bar, route/view switching, cross-feature query invalidation.
- `src/features/accounts/`: account details, security settings, profile picture, login state, client profiles, manual pending-account OTP.
- `src/features/chat/`: contact list, chat thread, send/read/delete flows.
- `src/features/registration/`: add-account flow, registration OTP, account-transfer recovery, SMSBower/Hero-SMS registration task, registration debug records.
- `src/features/settings/`: remote/local service settings and SMS platform settings.
- `src/features/cancel-queue/`: SMS activation cancel queue UI and queue view helpers.
- `src/shared/`: reusable UI, toast types, avatar crop, error and formatting helpers.
- `src/styles/index.css`: renderer style entry. Domain styles live in `src/styles/*.css`; do not recreate a single large stylesheet.
- `electron/main.ts`: Electron lifecycle, window creation, and IPC registration only.
- `electron/config-service.ts`: config loading, secure password/API-key patching, public config projection.
- `electron/api-proxy.ts`: `/api/wa/...` proxy, asset fetch, connection test.
- `electron/local-service.ts`: packaged `wa-app-service` process management.
- `electron/openai-phone-bridge.ts`: OpenAI phone check bridge HTTP server and pending task queue.
- `electron/sms-platform-ipc.ts`: SMSBower/Hero-SMS platform calls and mock SMS platform behavior.
- `electron/sms-cancel-queue-ipc.ts`: cancel queue service lifecycle and IPC-facing helpers.
- `scripts/smoke-mock-ui.ps1`: packaged-app mock UI smoke. PowerShell helpers are at the bottom; the mock API and CDP inspector are embedded JS fixtures.

## Do Not Migrate Yet

Do not add UI for upstream components that are visible but explicitly not implemented.

- `WaAccountChangeNumberCard` in upstream:
  - Files: `webui/src/dashboard/wa-account-change-number-card.tsx`, mounted from `webui/src/dashboard/wa-account-security.tsx`
  - User-facing label: `账号迁移 / 换绑手机号`
  - It is not the same as the registration account-transfer challenge.
  - In upstream commit `702129d`, clicking the button only calls `onError('换绑手机号链路尚未接入：需要按 APK ChangeNumber/ChangeNumberOverview 链路补齐后端实现')`.
  - Desktop should not show this placeholder until upstream adds a real backend endpoint/working flow.

## Important Terminology

- "Registration account transfer challenge" means the registration flow returns `registration_phase === ACCOUNT_TRANSFER_WAITING` or an `account_transfer_challenge`. Desktop surfaces this through `RegistrationRecoveryPanel`.
- "Change Number / 换绑手机号" is an account security setting placeholder in upstream WebUI. It is not implemented upstream and should remain absent from desktop.

## How To Continue After Upstream Updates

Use this sequence when `pood1e/wa-app` changes:

1. Clone or update upstream into a temporary directory.

   ```powershell
   $tmp = Join-Path $env:TEMP "wa-app-source-audit"
   if (Test-Path $tmp) {
     git -C $tmp fetch origin
     git -C $tmp reset --hard origin/main
   } else {
     git clone https://github.com/pood1e/wa-app.git $tmp
   }
   git -C $tmp log -1 --format="%h %H %cI %s"
   ```

2. Compare WebUI endpoint usage against the desktop API layer.

   Source files to inspect first:

   - Upstream: `webui/src/dashboard/wa-api.ts`
   - Desktop: `src/api.ts`
   - Desktop shell: `src/app/App.tsx`
   - Desktop feature folders: `src/features/accounts`, `src/features/chat`, `src/features/registration`
   - Desktop smoke: `scripts/smoke-mock-ui.ps1`

3. Check upstream route and page changes.

   Source files to inspect:

   - `webui/src/dashboard/wa-routes.tsx`
   - `webui/src/dashboard/wa-page.tsx`
   - `webui/src/dashboard/wa-account-add.tsx`
   - `webui/src/dashboard/wa-account-detail.tsx`
   - `webui/src/dashboard/wa-account-security.tsx`
   - `webui/src/dashboard/wa-inbox.tsx`

4. Classify differences before coding.

   - Real working upstream feature with API call: migrate it.
   - Visible upstream placeholder with no backend implementation: document it under "Do Not Migrate Yet".
   - Pure styling/router/shadcn structure: do not port directly; preserve desktop architecture.
   - Desktop-only enhancement: keep it unless it conflicts with upstream behavior.

5. Implement in small phases.

   Suggested phase order:

   - API/types helpers in `src/api.ts` and `src/types.ts`
   - UI integration in the matching `src/features/*` folder plus shell wiring in `src/app/App.tsx` only when navigation/sidebar behavior changes
   - Result parsing/model updates in `src/result-model.ts` or small helpers
   - Mock smoke coverage in `scripts/smoke-mock-ui.ps1`
   - Documentation update in this file and `README.md` if the user-facing matrix changes

6. Test before committing.

   Minimum local validation:

   ```powershell
   npm run lint
   npm test
   npm run typecheck
   npm run build
   npx electron-builder --dir
   npm run smoke:mock-ui
   ```

   Optional remote validation when a password is available:

   ```powershell
   $env:WA_APP_ELECTRON_SMOKE_PASSWORD = "<password>"
   npm run smoke:remote-api
   npm run smoke:electron
   Remove-Item Env:\WA_APP_ELECTRON_SMOKE_PASSWORD -ErrorAction SilentlyContinue
   ```

7. Commit by phase.

   Keep commits reviewable. Good commit shapes:

   - `feat: add desktop <feature> api`
   - `feat: surface <feature> in desktop ui`
   - `refactor: align desktop <model> parsing`
   - `test: cover <feature> desktop smoke`
   - `docs: update wa-app migration parity`

## Last Verification

Last full local validation before this handoff:

- `npm run lint`: passed
- `npm test`: passed
- `npm run typecheck`: passed
- `npm run build`: passed
- `npx electron-builder --dir`: passed
- `npm run smoke:mock-ui`: passed

Additional verification after re-auditing upstream:

- `npm test`: passed, 18 test files, 136 tests
- `git status --short --branch`: clean at the time this file was added
