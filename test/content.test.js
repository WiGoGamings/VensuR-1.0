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
