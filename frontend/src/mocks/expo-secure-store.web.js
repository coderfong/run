export async function getItemAsync(key) {
  return localStorage.getItem(key);
}

export async function setItemAsync(key, value) {
  localStorage.setItem(key, value);
}

export async function deleteItemAsync(key) {
  localStorage.removeItem(key);
}
