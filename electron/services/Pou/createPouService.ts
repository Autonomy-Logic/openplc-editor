function CreatePouService(data: { name?: string; pouType?: string }) {
  const pou = new Object(data)
  return pou
}

export default CreatePouService
