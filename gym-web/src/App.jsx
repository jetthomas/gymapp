import { useState } from 'react'
import LoginForm from './LoginForm'
import './App.css'
export default function App() {
const [token, setToken] = useState(null)
if (!token) {
return <LoginForm onLoggedIn={setToken} />
}
return (
<div className="card">
<h1>Logged in!</h1>
<button onClick={() => setToken(null)}>Log out</button></div>)}
