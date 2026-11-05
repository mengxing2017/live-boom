liveboom.connect((services) => {
  let remaining = 0, started = 0, timer, name, input;
  const stage = document.getElementById('stage');
  function finish() { timer = undefined; services.result('completed'); }
  function resume() { if (!timer && remaining > 0) { started = performance.now(); timer = setTimeout(finish, remaining); } }
  function pause() { if (timer) { clearTimeout(timer); timer = undefined; remaining = Math.max(1, remaining - (performance.now() - started)); } }
  return {
    prepare(value) { return { ...value, nickname: value.nickname.trim() }; },
    play(value, config) {
      input = value; remaining = config.duration * 1000;
      stage.replaceChildren();
      const title = document.createElement('p'); title.textContent = '心意登记簿 · 手动登记';
      name = document.createElement('h1'); name.textContent = input.nickname;
      const message = document.createElement('p'); message.textContent = input.message || '感谢参与';
      stage.append(title, name, message); resume();
    },
    pause, resume,
    dispose() { clearTimeout(timer); timer = undefined; stage.replaceChildren(); },
  };
});
