LikeBoom.connect((services) => {
  let remaining = 0, start = 0, timer;
  const stage = document.getElementById('stage');
  function pause() { if (timer) { clearTimeout(timer); timer = undefined; remaining = Math.max(1, remaining - (performance.now() - start)); } }
  function resume() { if (!timer && remaining > 0) { start = performance.now(); timer = setTimeout(() => { timer = undefined; services.result('completed'); }, remaining); } }
  return {
    prepare: input => ({ ...input, nickname: input.nickname.trim() }),
    play(input, config) {
      remaining = config.duration * 1000; stage.replaceChildren();
      const label = document.createElement('p'); label.textContent = '模拟制作台 · 本地互动';
      const name = document.createElement('h1'); name.textContent = input.nickname;
      const note = document.createElement('p'); note.textContent = input.message || '你的专属卡片正在制作';
      stage.append(label, name, note);
      name.animate([{ opacity: 0.1, clipPath: 'inset(100% 0 0)' }, { opacity: 1, clipPath: 'inset(0)' }], { duration: remaining, fill: 'forwards' }); resume();
    },
    pause() { pause(); for (const a of stage.getAnimations({subtree:true})) a.pause(); },
    resume() { resume(); for (const a of stage.getAnimations({subtree:true})) a.play(); },
    dispose() { clearTimeout(timer); timer = undefined; for (const a of stage.getAnimations({subtree:true})) a.cancel(); stage.replaceChildren(); },
  };
});
