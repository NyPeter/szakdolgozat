import { useState, useContext } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { Menu } from './menu/Menu';
import { Login } from './login/Login';
import { Register } from './register/Register';
import { ProtectedRoute } from '../ProtectedRoute';


function App() {

  return (
    <>      
      <BrowserRouter>
        <Routes>
          <Route index element={<Menu />} />
          <Route path="Register" element={<Register />} />
          <Route path="Login" element={<Login />} />
          {/* <Route path="Leaderboard" element={<ProtectedRoute><Leaderboard /></ProtectedRoute>} />
          <Route path="Games" element={<ProtectedRoute><Games /></ProtectedRoute>} />
          <Route path="Game" element={<ProtectedRoute><Lobby /></ProtectedRoute>} >
            <Route path=":id" element={<ProtectedRoute><Lobby /></ProtectedRoute>} />
          </Route>
          <Route path="Profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} /> */}
          <Route path="*" element={<Navigate to='/' />} />
        </Routes>
      </BrowserRouter>
    </>
  )
}

export default App
