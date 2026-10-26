import uvicorn

if __name__ == "__main__":
    # 127.0.0.1: aceita conexões só deste computador (o Electron roda na mesma máquina).
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
