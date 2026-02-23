export function notFound(req, res) {
  res.status(404).json({ error: 'Not Found' })
}
export default notFound
