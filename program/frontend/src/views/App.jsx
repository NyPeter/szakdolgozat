import { useState, useContext } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { Menu } from './menu/Menu';
import { Login } from './login/Login';
import { Register } from './register/Register';
import { ProtectedRoute } from '../ProtectedRoute';
import { AdminRoute } from '../AdminRoute';
import { LeaderBoard } from './leaderBoard/LeaderBoard';
import { Games } from './games/Games';
import { Game } from './game/Game';
import { Profile } from './profile/Profile';
import { Admin } from './admin/Admin';


function App() {

  return (
    <>      
      <BrowserRouter>
        <Routes>
          <Route index element={<Menu />} />
          <Route path="Register" element={<Register />} />
          <Route path="Login" element={<Login />} />
          <Route path="Leaderboard" element={<ProtectedRoute><LeaderBoard /></ProtectedRoute>} />
          <Route path="Games" element={<ProtectedRoute><Games /></ProtectedRoute>} />
          <Route path="Game/:id" element={<ProtectedRoute><Game /></ProtectedRoute>} />
          <Route path="Profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="Admin" element={<AdminRoute><Admin /></AdminRoute>} />
          <Route path="*" element={<Navigate to='/' />} />
        </Routes>
      </BrowserRouter>
    </>
  )
}

export default App
