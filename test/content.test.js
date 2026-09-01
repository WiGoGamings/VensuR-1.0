import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, createVerifiedUser, authHeaders } from './helpers.js'

let server

before(async () => {
  server = await startTestServer(8798)
})

after(async () => {
  if (server) await server.stop()
})

test('editar el perfil actualiza nombre, bio y visibilidad', async () => {
  const { token } = await createVerifiedUser(server.baseUrl)

  const res = await fetch(`${server.baseUrl}/api/auth/me`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ displayName: 'Nombre Nuevo', bio: 'Reportera ciudadana', profileVisibility: 'public' }),
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.user.displayName, 'Nombre Nuevo')
  assert.equal(body.user.bio, 'Reportera ciudadana')
  assert.equal(body.user.profileVisibility, 'public')
})

test('seguir y dejar de seguir a otro usuario ajusta los contadores', async () => {
  const alice = await createVerifiedUser(server.baseUrl, { visibility: 'public' })
  const bob = await createVerifiedUser(server.baseUrl, { visibility: 'public' })

  const followRes = await fetch(`${server.baseUrl}/api/content/users/${bob.username}/follow`, {
    method: 'POST',
    headers: authHeaders(alice.token),
  })
  assert.equal(followRes.status, 201)
  const followBody = await followRes.json()
  assert.equal(followBody.relationship.isFollowing, true)
  assert.equal(followBody.counts.followers, 1)

  const profileRes = await fetch(`${server.baseUrl}/api/content/users/${bob.username}`, {
    headers: authHeaders(alice.token),
  })
  const profileBody = await profileRes.json()
  assert.equal(profileBody.relationship.isFollowing, true)
  assert.equal(profileBody.user.followersCount, 1)

  const unfollowRes = await fetch(`${server.baseUrl}/api/content/users/${bob.username}/follow`, {
    method: 'DELETE',
    headers: authHeaders(alice.token),
  })
  assert.equal(unfollowRes.status, 200)
  const unfollowBody = await unfollowRes.json()
  assert.equal(unfollowBody.relationship.isFollowing, false)
  assert.equal(unfollowBody.counts.followers, 0)
})

test('directorio de en vivo muestra sesiones activas para usuarios autenticados', async () => {
  const owner = await createVerifiedUser(server.baseUrl, { visibility: 'public' })
  const viewer = await createVerifiedUser(server.baseUrl, { visibility: 'public' })

  const startRes = await fetch(`${server.baseUrl}/api/content/live/sessions`, {
    method: 'POST',
    headers: authHeaders(owner.token),
    body: JSON.stringify({ title: 'Directo abierto de prueba' }),
  })
  assert.equal(startRes.status, 201)
  const { session } = await startRes.json()
  assert.ok(session?.id)

  const listRes = await fetch(`${server.baseUrl}/api/content/live/sessions`, {
    headers: authHeaders(viewer.token),
  })
  assert.equal(listRes.status, 200)
  const listBody = await listRes.json()
  const found = listBody.items.find((item) => item.id === session.id)
  assert.ok(found)
  assert.equal(found.canView, true)

  await fetch(`${server.baseUrl}/api/content/live/sessions/${session.id}/stop`, {
    method: 'POST',
    headers: authHeaders(owner.token),
  })
})

test('seguidores reciben notificaciones por en vivo, historia y publicacion', async () => {
  const owner = await createVerifiedUser(server.baseUrl, { visibility: 'public' })
  const follower = await createVerifiedUser(server.baseUrl, { visibility: 'public' })
  const outsider = await createVerifiedUser(server.baseUrl, { visibility: 'public' })

  const followRes = await fetch(`${server.baseUrl}/api/content/users/${owner.username}/follow`, {
    method: 'POST',
    headers: authHeaders(follower.token),
  })
  assert.equal(followRes.status, 201)

  const liveRes = await fetch(`${server.baseUrl}/api/content/live/sessions`, {
    method: 'POST',
    headers: authHeaders(owner.token),
    body: JSON.stringify({ title: 'Directo para seguidores' }),
  })
  assert.equal(liveRes.status, 201)
  const liveBody = await liveRes.json()
  assert.ok(liveBody.session?.id)

  const storyForm = new FormData()
  storyForm.append('title', 'Historia para seguidores')
  storyForm.append('description', 'Prueba de alerta de historia')
  const storyRes = await fetch(`${server.baseUrl}/api/content/me/stories`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${owner.token}` },
    body: storyForm,
  })
  assert.equal(storyRes.status, 201)
  const storyBody = await storyRes.json()
  assert.ok(storyBody.story?.id)

  const postForm = new FormData()
  postForm.append('caption', 'Publicacion para notificar a seguidores')
  const postRes = await fetch(`${server.baseUrl}/api/content/me/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${owner.token}` },
    body: postForm,
  })
  assert.equal(postRes.status, 201)
  const postBody = await postRes.json()
  assert.ok(postBody.post?.id)

  const inboxRes = await fetch(`${server.baseUrl}/api/content/me/notifications`, {
    headers: authHeaders(follower.token),
  })
  assert.equal(inboxRes.status, 200)
  const inbox = await inboxRes.json()
  assert.ok(Array.isArray(inbox.items))
  assert.ok(inbox.unread >= 3)

  const byType = new Map(inbox.items.map((item) => [item.type, item]))
  assert.ok(byType.has('live_started'))
  assert.ok(byType.has('story_published'))
  assert.ok(byType.has('post_published'))
  assert.ok(byType.get('live_started').targetPath.includes(liveBody.session.id))
  assert.ok(byType.get('story_published').targetPath.includes(storyBody.story.id))
  assert.ok(byType.get('post_published').targetPath.includes(postBody.post.id))

  const outsiderRes = await fetch(`${server.baseUrl}/api/content/me/notifications`, {
    headers: authHeaders(outsider.token),
  })
  assert.equal(outsiderRes.status, 200)
  const outsiderInbox = await outsiderRes.json()
  assert.equal(outsiderInbox.items.length, 0)

  const readRes = await fetch(`${server.baseUrl}/api/content/me/notifications/read`, {
    method: 'POST',
    headers: authHeaders(follower.token),
    body: JSON.stringify({}),
  })
  assert.equal(readRes.status, 200)
  const readBody = await readRes.json()
  assert.equal(readBody.unread, 0)

  await fetch(`${server.baseUrl}/api/content/live/sessions/${liveBody.session.id}/stop`, {
    method: 'POST',
    headers: authHeaders(owner.token),
  })
})

test('amistad reciproca habilita ver contenido privado', async () => {
  const owner = await createVerifiedUser(server.baseUrl, { visibility: 'private' })
  const friend = await createVerifiedUser(server.baseUrl, { visibility: 'public' })
  const stranger = await createVerifiedUser(server.baseUrl, { visibility: 'public' })

  // El dueno publica un post.
  const form = new FormData()
  form.append('caption', 'Contenido privado del owner')
  form.append('location', 'Merida')
  const postRes = await fetch(`${server.baseUrl}/api/content/me/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${owner.token}` },
    body: form,
  })
  const { post } = await postRes.json()
  assert.ok(post.id)

  // Un extrano no ve el post en el feed.
  const strangerFeed = await (await fetch(`${server.baseUrl}/api/content/posts`, {
    headers: authHeaders(stranger.token),
  })).json()
  assert.equal(strangerFeed.items.some((item) => item.id === post.id), false)

  // El dueno agrega como amigo al "friend".
  const addFriendRes = await fetch(`${server.baseUrl}/api/content/me/friends/${friend.username}`, {
    method: 'POST',
    headers: authHeaders(owner.token),
  })
  assert.equal(addFriendRes.status, 201)

  // Ahora el amigo si ve el post.
  const friendFeed = await (await fetch(`${server.baseUrl}/api/content/posts`, {
    headers: authHeaders(friend.token),
  })).json()
  assert.equal(friendFeed.items.some((item) => item.id === post.id), true)

  // Quitar la amistad revoca el acceso.
  await fetch(`${server.baseUrl}/api/content/me/friends/${friend.username}`, {
    method: 'DELETE',
    headers: authHeaders(owner.token),
  })
  const friendFeedAfter = await (await fetch(`${server.baseUrl}/api/content/posts`, {
    headers: authHeaders(friend.token),
  })).json()
  assert.equal(friendFeedAfter.items.some((item) => item.id === post.id), false)
})

test('comentar un post incrementa el contador y aparece en el listado', async () => {
  const author = await createVerifiedUser(server.baseUrl, { visibility: 'public' })
  const commenter = await createVerifiedUser(server.baseUrl, { visibility: 'public' })

  const form = new FormData()
  form.append('caption', 'Post para comentar')
  const { post } = await (await fetch(`${server.baseUrl}/api/content/me/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${author.token}` },
    body: form,
  })).json()

  const commentRes = await fetch(`${server.baseUrl}/api/content/posts/${post.id}/comments`, {
    method: 'POST',
    headers: authHeaders(commenter.token),
    body: JSON.stringify({ text: 'Gracias por el reporte' }),
  })
  assert.equal(commentRes.status, 201)
  const commentBody = await commentRes.json()
  assert.equal(commentBody.post.comments, 1)

  const listRes = await fetch(`${server.baseUrl}/api/content/posts/${post.id}/comments`)
  const listBody = await listRes.json()
  assert.equal(listBody.items.length, 1)
  assert.equal(listBody.items[0].text, 'Gracias por el reporte')
})

test('crear historia: aparece en el feed y la reaccion es idempotente', async () => {
  const owner = await createVerifiedUser(server.baseUrl, { visibility: 'public' })
  const viewer = await createVerifiedUser(server.baseUrl, { visibility: 'public' })

  const form = new FormData()
  form.append('title', 'Historia ciudadana')
  form.append('description', 'Seguimiento comunitario')
  const storyRes = await fetch(`${server.baseUrl}/api/content/me/stories`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${owner.token}` },
    body: form,
  })
  assert.equal(storyRes.status, 201)
  const { story } = await storyRes.json()
  assert.ok(story.id)

  const feed = await (await fetch(`${server.baseUrl}/api/content/stories`, {
    headers: authHeaders(viewer.token),
  })).json()
  assert.equal(feed.items.some((item) => item.id === story.id), true)

  const like1 = await (await fetch(`${server.baseUrl}/api/content/stories/${story.id}/reaction`, {
    method: 'PATCH',
    headers: authHeaders(viewer.token),
    body: JSON.stringify({ delta: 1 }),
  })).json()
  assert.equal(like1.liked, true)
  assert.equal(like1.story.reactions, 1)

  const like2 = await (await fetch(`${server.baseUrl}/api/content/stories/${story.id}/reaction`, {
    method: 'PATCH',
    headers: authHeaders(viewer.token),
    body: JSON.stringify({ delta: 1 }),
  })).json()
  assert.equal(like2.story.reactions, 1)
})

test('la busqueda de usuarios encuentra por nombre de usuario', async () => {
  const target = await createVerifiedUser(server.baseUrl, { visibility: 'public' })

  const res = await fetch(`${server.baseUrl}/api/content/users/search?q=${target.username}`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.items.some((item) => item.username === target.username), true)
})

test('la biblioteca de musica devuelve pistas', async () => {
  const res = await fetch(`${server.baseUrl}/api/content/music-library`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(Array.isArray(body.items))
  assert.ok(body.items.length > 0)
  assert.ok(body.items[0].id)
})

test('GET /api/content/me/posts devuelve todas las publicaciones del usuario', async () => {
  const author = await createVerifiedUser(server.baseUrl, { visibility: 'public' })

  for (let i = 0; i < 3; i += 1) {
    const form = new FormData()
    form.append('caption', `Post propio ${i}`)
    await fetch(`${server.baseUrl}/api/content/me/posts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${author.token}` },
      body: form,
    })
  }

  const res = await fetch(`${server.baseUrl}/api/content/me/posts`, { headers: authHeaders(author.token) })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(body.items.length >= 3)
  assert.ok(body.items.every((item) => typeof item.caption === 'string'))
})

test('grabaciones de en vivo: subir, listar, visibilidad y borrar', async () => {
  const owner = await createVerifiedUser(server.baseUrl, { visibility: 'public' })
  const stranger = await createVerifiedUser(server.baseUrl, { visibility: 'public' })

  const fakeVideo = new Blob([new Uint8Array(2048)], { type: 'video/webm' })
  const form = new FormData()
  form.append('media', fakeVideo, 'grabacion.webm')
  form.append('title', 'Mi transmisión de prueba')
  form.append('durationSec', '42')

  const uploadRes = await fetch(`${server.baseUrl}/api/content/live/recordings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${owner.token}` },
    body: form,
  })
  assert.equal(uploadRes.status, 201)
  const uploadBody = await uploadRes.json()
  assert.equal(uploadBody.ttlHours, 72)
  assert.equal(uploadBody.recording.title, 'Mi transmisión de prueba')
  assert.equal(uploadBody.recording.visibility, 'public')
  assert.ok(new Date(uploadBody.recording.expiresAt).getTime() > Date.now())
  const recordingId = uploadBody.recording.id

  const mine = await (await fetch(`${server.baseUrl}/api/content/me/recordings`, { headers: authHeaders(owner.token) })).json()
  assert.equal(mine.items.length, 1)

  // Un extraño ve la grabación pública del owner.
  const publicView = await (await fetch(`${server.baseUrl}/api/content/users/${owner.username}/recordings`, {
    headers: authHeaders(stranger.token),
  })).json()
  assert.equal(publicView.items.length, 1)

  // Si el owner se hace privado, el extraño (no amigo) ya no la ve.
  await fetch(`${server.baseUrl}/api/auth/me`, {
    method: 'PATCH',
    headers: authHeaders(owner.token),
    body: JSON.stringify({ profileVisibility: 'private' }),
  })
  const privateView = await (await fetch(`${server.baseUrl}/api/content/users/${owner.username}/recordings`, {
    headers: authHeaders(stranger.token),
  })).json()
  assert.equal(privateView.items.length, 0)

  // Borrar.
  const delRes = await fetch(`${server.baseUrl}/api/content/me/recordings/${recordingId}`, {
    method: 'DELETE',
    headers: authHeaders(owner.token),
  })
  assert.equal(delRes.status, 200)
  const afterDelete = await (await fetch(`${server.baseUrl}/api/content/me/recordings`, { headers: authHeaders(owner.token) })).json()
  assert.equal(afterDelete.items.length, 0)
})

test('el SDP del en vivo conserva el CRLF final (setRemoteDescription no falla)', async () => {
  const owner = await createVerifiedUser(server.baseUrl, { visibility: 'public' })

  const sessionRes = await fetch(`${server.baseUrl}/api/content/live/sessions`, {
    method: 'POST',
    headers: authHeaders(owner.token),
    body: JSON.stringify({ title: 'Directo de prueba' }),
  })
  assert.equal(sessionRes.status, 201)
  const { session } = await sessionRes.json()

  // SDP mínimo cuya última línea NO trae CRLF: el servidor debe reponerlo.
  const rawSdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 126\r\na=rtpmap:126 telephone-event/8000'

  const offerRes = await fetch(`${server.baseUrl}/api/content/live/sessions/${session.id}/viewers/offer`, {
    method: 'POST',
    headers: authHeaders(owner.token),
    body: JSON.stringify({ offer: { type: 'offer', sdp: rawSdp } }),
  })
  assert.equal(offerRes.status, 201)

  const offersRes = await fetch(`${server.baseUrl}/api/content/live/sessions/${session.id}/offers`, {
    headers: authHeaders(owner.token),
  })
  const offersBody = await offersRes.json()
  assert.equal(offersBody.items.length, 1)
  assert.ok(offersBody.items[0].offer.sdp.endsWith('telephone-event/8000\r\n'))
})
