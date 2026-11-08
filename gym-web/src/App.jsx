import { useState } from 'react'
import LoginForm from './LoginForm'
import CreateAccountForm from './CreateAccountForm'
import ReactivateAccountForm from './ReactivateAccountForm'
import { deleteaccount } from './api'
import './App.css'
export default function App() {
const [token, setToken] = useState(null)
const [page, setPage] = useState('login')



if (!token && page === 'create') {
return <CreateAccountForm onBack={() => setPage('login')} />
}
if (!token && page === 'reactivate') {
return <ReactivateAccountForm onBack={() => setPage('login')} />
}
if (!token) {
return <LoginForm onLoggedIn={setToken} onCreateAccount={() => setPage('create')} onReactivateAccount={() => setPage('reactivate')} />
}
return (
<div className="card">
<h1>Logged in!</h1>
<button onClick={() => setToken(null)}>Log out</button>
<button onClick={async () => { await deleteaccount(token); setToken(null) }}>Delete Account</button>
</div>)}


