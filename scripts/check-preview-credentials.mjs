if (process.env.DEEPSEEK_API_KEY?.trim() === undefined || process.env.DEEPSEEK_API_KEY.trim() === '') {
  console.error('Live Agent Team preview requires DEEPSEEK_API_KEY. Export a valid credential, then run npm run preview again.')
  process.exit(1)
}
