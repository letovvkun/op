/** Человеко-понятные сообщения для наиболее частых ошибок загрузки данных. */
export function getDataErrorMessage(error, fallback = 'Не удалось загрузить данные.') {
  const code = String(error?.code || '').toLowerCase();

  if (code.includes('unavailable') || code.includes('network-request-failed') || code.includes('deadline-exceeded')) {
    return 'Не удалось подключиться к серверу. Проверьте интернет и попробуйте ещё раз.';
  }
  if (code.includes('permission-denied') || code.includes('unauthenticated')) {
    return 'Нет доступа к этим данным. Попробуйте обновить страницу позже.';
  }
  if (code.includes('not-found')) {
    return 'Запрашиваемые данные не найдены.';
  }
  return fallback;
}

export function logDataError(context, error) {
  console.error(`[LetovShiyori] ${context}`, error);
}
