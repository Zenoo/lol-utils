import koffi from 'koffi';

export function windowsKeyDown(): ((key: number) => boolean) | undefined {
  if (process.platform !== 'win32') {
    return undefined;
  }
  const user = koffi.load('user32.dll');
  const getState = user.func('int16 __stdcall GetAsyncKeyState(int key)');

  return (key) => (getState(key) & 0x8000) !== 0;
}

export function windowsForeground() {
  if (process.platform !== 'win32') {
    return () => null;
  }
  const user = koffi.load('user32.dll'),
    kernel = koffi.load('kernel32.dll');
  const getForeground = user.func('void * __stdcall GetForegroundWindow()');
  const getPid = user.func(
    'uint32 __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *processId)',
  );
  const rectType = koffi.struct('LolUtilsRect', {
    left: 'long',
    top: 'long',
    right: 'long',
    bottom: 'long',
  });
  const getRect = user.func('GetClientRect', 'bool', [
    'void *',
    koffi.out(koffi.pointer(rectType)),
  ]);
  const pointType = koffi.struct('LolUtilsPoint', { x: 'long', y: 'long' });
  const toScreen = user.func('ClientToScreen', 'bool', [
    'void *',
    koffi.inout(koffi.pointer(pointType)),
  ]);
  const open = kernel.func('void * __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
  const query = kernel.func(
    'bool __stdcall QueryFullProcessImageNameW(void *process, uint32 flags, _Out_ uint16 *name, _Inout_ uint32 *size)',
  );
  const close = kernel.func('bool __stdcall CloseHandle(void *handle)');
  let cachedPid = 0,
    cachedName = '',
    cachedAt = 0;

  return () => {
    const hwnd = getForeground();
    if (!hwnd) {
      return null;
    }
    const pid = [0];
    getPid(hwnd, pid);
    if (pid[0] !== cachedPid || Date.now() - cachedAt > 5000) {
      cachedPid = pid[0];
      cachedName = '';
      cachedAt = Date.now();
      const processHandle = open(0x1000, false, pid[0]);
      if (processHandle) {
        try {
          const name = Buffer.alloc(2048);
          const size = [1024];
          if (query(processHandle, 0, name, size)) {
            cachedName = name.toString('utf16le', 0, size[0] * 2);
          }
        } finally {
          close(processHandle);
        }
      }
    }
    if (!/\\League of Legends\.exe$/i.test(cachedName)) {
      return null;
    }
    const rect = { left: 0, top: 0, right: 0, bottom: 0 };
    if (!getRect(hwnd, rect)) {
      return null;
    }
    const origin = { x: 0, y: 0 };
    if (!toScreen(hwnd, origin)) {
      return null;
    }
    if (rect.right - rect.left < 300 || rect.bottom - rect.top < 300) {
      return null;
    }

    return {
      executable: cachedName,
      x: origin.x,
      y: origin.y,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
    };
  };
}
