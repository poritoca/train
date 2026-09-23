'use strict';
// Foreground notifications only. No server, background GPS, or scheduled push.
(() => {
  const KEY = 'ekikan-notifications-v1';
  const instance = globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
  let wanted = false, busy = false, timer = null, deadline = 0, testEpoch = 0, rideEpoch = 0;
  let message = '', delay = 10;
  try { wanted = localStorage.getItem(KEY) === 'on'; } catch {}
  const standalone = () => navigator.standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches;
  const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function reason() {
    if (!window.isSecureContext) return 'GitHub Pagesなど、HTTPSの公開URLで開いてください。';
    if (ios() && !standalone()) return 'Safariの共有から「ホーム画面に追加」し、追加したアイコンから開いてください。';
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'この環境ではシステム通知を利用できません。画面内のお知らせは引き続き使えます。';
    if (Notification.permission === 'denied') return '通知が許可されていません。iPhoneの「設定 → 通知 → 駅間ナビ」で許可してください。';
    return '';
  }
  const isEnabled = () => wanted && !reason() && Notification.permission === 'granted';
  function save() { try { localStorage.setItem(KEY, wanted ? 'on' : 'off'); } catch {} }
  function refresh() {
    const why = reason(), enabled = isEnabled();
    document.querySelectorAll('[data-notify-panel]').forEach(panel => {
      panel.querySelector('[data-notify-state]').textContent = why || (enabled ? '通知はオンです' : '通知はオフです');
      const enable = panel.querySelector('[data-notify-enable]');
      enable.textContent = busy ? '確認中…' : enabled ? '通知をオフにする' : '通知を許可する';
      enable.disabled = busy || !!why;
      panel.querySelector('[data-notify-delay]').value = String(delay);
      panel.querySelector('[data-notify-delay]').disabled = !!timer;
      panel.querySelector('[data-notify-now]').disabled = !enabled || busy || !!timer;
      const later = panel.querySelector('[data-notify-later]');
      later.disabled = !enabled || busy;
      later.textContent = timer ? 'テストを中止' : delay + '秒後に通知';
      const result = panel.querySelector('[data-notify-result]');
      const text = timer ? '通知まであと ' + Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) + ' 秒。この画面を開いたままお待ちください。' : message;
      if (result.textContent !== text) result.textContent = text;
    });
  }
  async function registration() {
    let timeout;
    try {
      return await Promise.race([
        (async () => {
          const scope = new URL('./', location.href).href;
          let reg = await navigator.serviceWorker.getRegistration(scope);
          if (!reg || reg.scope !== scope) reg = await navigator.serviceWorker.register('./sw.js?v=49.0', { scope: './' });
          if (!reg.active) reg = await navigator.serviceWorker.ready;
          if (reg.scope !== scope || typeof reg.showNotification !== 'function') throw new Error('unavailable');
          return reg;
        })(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), 8000); })
      ]);
    } finally { clearTimeout(timeout); }
  }
  async function enable() {
    if (busy || reason()) return;
    if (isEnabled()) {
      wanted = false; save(); cancelTest('通知をオフにしました。'); clearRide(); refresh(); return;
    }
    busy = true;
    try {
      // Request synchronously inside the tap handler, before any other await.
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      wanted = permission === 'granted'; save();
      message = wanted ? '通知を許可しました。まずはテストで表示・振動を確認してください。' : '通知は有効になっていません。';
    } catch { wanted = false; save(); message = '通知の許可を取得できませんでした。ホーム画面のアイコンから開いてお試しください。'; }
    finally { busy = false; refresh(); }
  }
  async function notify(title, body, { test = false, epoch = null } = {}) {
    if (!isEnabled() || document.visibilityState !== 'visible') return false;
    const ride = rideEpoch;
    try {
      const reg = await registration();
      if (!isEnabled() || document.visibilityState !== 'visible' || (test ? epoch !== testEpoch : ride !== rideEpoch)) return false;
      await reg.showNotification(title, {
        body, tag: test ? 'ekikan-test' : 'ekikan-ride',
        icon: new URL('./icon-192.png', location.href).href,
        silent: false, renotify: true, data: { kind: test ? 'test' : 'ride', epoch: ride, instance }
      });
      return true;
    } catch {
      message = '通知を表示できませんでした。通知の許可と通信状態を確認して、もう一度お試しください。';
      refresh(); return false;
    }
  }
  function cancelTest(text = '') {
    const active = !!timer;
    clearInterval(timer); timer = null; deadline = 0; testEpoch++;
    if (text) message = text;
    refresh(); return active;
  }
  async function testNow(epoch = ++testEpoch) {
    const ok = await notify('駅間ナビ · 通知テスト', '通知テストです。電車やGPSは使っていません。表示と振動を確認してください。', { test: true, epoch });
    if (ok && epoch === testEpoch) { message = '通知の表示を要求しました。バナーや通知センター、実際の振動を確認してください。'; window.EkikanEffects?.announce('通知テスト', '降車のお知らせも、この光で表示します。'); }
    refresh();
  }
  function startTest() {
    if (timer) { cancelTest('テストを中止しました。'); return; }
    if (!isEnabled() || document.visibilityState !== 'visible') return;
    const epoch = ++testEpoch;
    deadline = Date.now() + delay * 1000;
    timer = setInterval(() => {
      if (document.visibilityState !== 'visible') { cancelTest('画面を閉じたため、テストを中止しました。'); return; }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        clearInterval(timer); timer = null;
        if (remaining < -5000) { cancelTest('処理が中断されたため、テストを中止しました。もう一度お試しください。'); return; }
        message = '通知を送っています…'; refresh(); void testNow(epoch);
      } else refresh();
    }, 250);
    refresh();
  }
  function clearRide() {
    const clearedEpoch = ++rideEpoch;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration(new URL('./', location.href).href).then(async reg => {
      if (reg?.scope === new URL('./', location.href).href && reg.getNotifications) {
        for (const n of await reg.getNotifications({ tag: 'ekikan-ride' })) {
          if (n.data?.instance !== instance || !Number.isFinite(n.data?.epoch) || n.data.epoch < clearedEpoch) n.close();
        }
      }
    }).catch(() => {});
  }
  function mount(container) {
    if (!container) return;
    container.innerHTML = '<div data-notify-panel><p data-notify-state class="notification-state" role="status"></p>' +
      '<button type="button" class="primary full" data-notify-enable>通知を許可する</button>' +
      '<div class="notification-test-box"><h3>通知をテスト</h3><p class="quiet-note">電車に乗らずに試せます。音を出したくない場合は、先にiPhoneを消音モードにしてください。</p>' +
      '<label class="field">通知までの時間<select data-notify-delay><option value="10">10秒</option><option value="30">30秒</option><option value="60">60秒</option></select></label>' +
      '<div class="grid"><button type="button" data-notify-now>今すぐ通知</button><button type="button" data-notify-later>10秒後に通知</button></div>' +
      '<p data-notify-result role="status" aria-live="polite" aria-atomic="true" class="notification-result"></p></div>' +
      '<p class="quiet-note">画面を開いている間の接近を通知します。画面オフ・他のアプリへの切り替えで、時間差テストは中止します。</p>' +
      '<details><summary>iPhoneの設定手順</summary><ol class="notification-steps"><li>Safariの共有 → ホーム画面に追加。「Webアプリとして開く」があればオンにします。</li><li>追加したアイコンから起動し、「通知を許可する」を押します。</li><li>設定 → 通知 → 駅間ナビで、通知・バナー・サウンドをオンにします。</li><li>設定 → サウンドと触覚 → 触覚を「常に再生」または「消音モードのときに再生」にします。音を出さない場合は本体を消音モードにします。</li><li>集中モード・時刻指定要約の対象から外し、テストで表示と振動を確認します。</li></ol><p class="quiet-note">通知の表示や振動はiPhoneの設定に従います。ホーム画面への追加でも、画面オフ中のGPS監視はできません。</p></details></div>';
    container.querySelector('[data-notify-enable]').onclick = enable;
    container.querySelector('[data-notify-now]').onclick = () => { void testNow(); };
    container.querySelector('[data-notify-later]').onclick = startTest;
    container.querySelector('[data-notify-delay]').onchange = e => { delay = Number(e.target.value); refresh(); };
    refresh();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') cancelTest('画面を閉じたため、テストを中止しました。');
    else refresh();
  });
  window.addEventListener('pagehide', () => cancelTest('ページを閉じたため、テストを中止しました。'));
  window.addEventListener('focus', refresh);
  window.EkikanNotifications = { mount, notify, isEnabled, cancelTest, clearRide };
  mount(document.getElementById('notificationSettings'));
})();
